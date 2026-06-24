#!/usr/bin/env python3
from __future__ import annotations

import argparse
import types
from pathlib import Path
from typing import Iterable

import torch
import torch.nn as nn
import torch.nn.functional as F

from ultralytics import YOLO
from ultralytics.cfg import DEFAULT_CFG
from ultralytics.models.yolo.detect import DetectionTrainer
from ultralytics.utils import LOGGER
from ultralytics.utils.torch_utils import unwrap_model


class FeatureHook:
    def __init__(self, module: nn.Module, layer_index: int):
        self.layer_index = layer_index
        self.features = None
        self.hook = module.register_forward_hook(self._hook_fn)

    def _hook_fn(self, module, inputs, output):
        self.features = output

    def close(self):
        self.hook.remove()


def _as_feature_list(hooks: Iterable[FeatureHook]) -> list[torch.Tensor]:
    feats: list[torch.Tensor] = []
    for hook in hooks:
        feat = hook.features
        if isinstance(feat, (list, tuple)):
            tensors = [x for x in feat if isinstance(x, torch.Tensor) and x.ndim == 4]
            if not tensors:
                raise RuntimeError(f"WFD hook layer {hook.layer_index} did not return 4D tensor features")
            feat = tensors[-1]
        if not isinstance(feat, torch.Tensor) or feat.ndim != 4:
            raise RuntimeError(f"WFD hook layer {hook.layer_index} produced invalid feature: {type(feat)}")
        feats.append(feat)
    return feats


def _crop_even(x: torch.Tensor) -> torch.Tensor:
    h = x.shape[-2] - (x.shape[-2] % 2)
    w = x.shape[-1] - (x.shape[-1] % 2)
    return x[..., :h, :w]


def haar_dwt(x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
    x = _crop_even(x)
    x00 = x[:, :, 0::2, 0::2]
    x01 = x[:, :, 0::2, 1::2]
    x10 = x[:, :, 1::2, 0::2]
    x11 = x[:, :, 1::2, 1::2]

    ll = (x00 + x01 + x10 + x11) * 0.5
    lh = (x00 - x01 + x10 - x11) * 0.5
    hl = (x00 + x01 - x10 - x11) * 0.5
    hh = (x00 - x01 - x10 + x11) * 0.5
    return ll, lh, hl, hh


def _align_pair(fs: torch.Tensor, ft: torch.Tensor, adapter: nn.Module) -> tuple[torch.Tensor, torch.Tensor]:
    ft = ft.detach()
    if fs.shape[-2:] != ft.shape[-2:]:
        ft = F.interpolate(ft, size=fs.shape[-2:], mode="bilinear", align_corners=False)
    fs = adapter(fs)
    if fs.shape[1] != ft.shape[1]:
        raise RuntimeError(f"WFD channel mismatch after adapter: student={tuple(fs.shape)}, teacher={tuple(ft.shape)}")
    return fs, ft


def feature_kd_loss(
    student_feats: list[torch.Tensor],
    teacher_feats: list[torch.Tensor],
    adapters: nn.ModuleList,
) -> torch.Tensor:
    loss = student_feats[0].new_tensor(0.0)
    n = 0
    for fs, ft, adapter in zip(student_feats, teacher_feats, adapters):
        fs, ft = _align_pair(fs, ft, adapter)
        loss = loss + F.mse_loss(fs, ft)
        n += 1
    return loss / max(n, 1)


def wavelet_distill_loss(
    student_feats: list[torch.Tensor],
    teacher_feats: list[torch.Tensor],
    adapters: nn.ModuleList,
    alpha: float = 1.5,
) -> torch.Tensor:
    loss = student_feats[0].new_tensor(0.0)
    n = 0
    for fs, ft, adapter in zip(student_feats, teacher_feats, adapters):
        fs, ft = _align_pair(fs, ft, adapter)
        lls, lhs, hls, hhs = haar_dwt(fs)
        llt, lht, hlt, hht = haar_dwt(ft)
        loss_ll = F.mse_loss(lls, llt)
        loss_hf = F.l1_loss(lhs, lht) + F.l1_loss(hls, hlt) + F.l1_loss(hhs, hht)
        loss = loss + loss_ll + alpha * loss_hf
        n += 1
    return loss / max(n, 1)


class YOLO26WFDTrainer(DetectionTrainer):
    """YOLO26 detection trainer with training-only Wavelet Feature Distillation.

    Teacher, feature hooks, Haar DWT, and 1x1 adapters are used only while training.
    Ultralytics still saves the normal student YOLO26 model for inference/export.
    """

    def __init__(self, cfg=DEFAULT_CFG, overrides=None, _callbacks=None):
        overrides = dict(overrides or {})
        self.teacher_path = str(overrides.pop("teacher"))
        self.lambda_kd = float(overrides.pop("lambda_kd", 0.3))
        self.lambda_wfd = float(overrides.pop("lambda_wfd", 0.2))
        self.wfd_alpha = float(overrides.pop("wfd_alpha", 1.5))
        self.wfd_warmup_epochs = int(overrides.pop("wfd_warmup_epochs", 10))
        self.kd_layers = [int(x) for x in overrides.pop("kd_layers", [16, 19, 22])]
        self.teacher_model: nn.Module | None = None
        self.student_hooks: list[FeatureHook] = []
        self.teacher_hooks: list[FeatureHook] = []
        self.kd_adapters: nn.ModuleList | None = None
        self._original_student_loss = None
        super().__init__(cfg=cfg, overrides=overrides, _callbacks=_callbacks)

    def _setup_train(self):
        super()._setup_train()
        self._setup_wfd()

    def _get_layers(self, model: nn.Module):
        module_list = getattr(model, "model", None)
        if module_list is None or not hasattr(module_list, "__len__") or not hasattr(module_list, "__getitem__"):
            raise RuntimeError("Could not find indexable YOLO layer list at model.model")
        return module_list

    def _register_hooks(self, model: nn.Module, layers: list[int]) -> list[FeatureHook]:
        module_list = self._get_layers(model)
        hooks = []
        for idx in layers:
            if idx < 0 or idx >= len(module_list):
                raise RuntimeError(f"WFD layer index {idx} is outside model layer range 0..{len(module_list) - 1}")
            hooks.append(FeatureHook(module_list[idx], idx))
        return hooks

    def _infer_channel_pairs(self, student: nn.Module, teacher: nn.Module) -> list[tuple[int, int]]:
        imgsz = int(getattr(self.args, "imgsz", 320) or 320)
        dummy = torch.zeros(1, 3, imgsz, imgsz, device=self.device)
        student.eval()
        teacher.eval()
        with torch.no_grad():
            student(dummy)
            teacher(dummy)
        s_feats = _as_feature_list(self.student_hooks)
        t_feats = _as_feature_list(self.teacher_hooks)
        return [(int(fs.shape[1]), int(ft.shape[1])) for fs, ft in zip(s_feats, t_feats)]

    def _current_wfd_weight(self) -> float:
        if self.wfd_warmup_epochs <= 0:
            return self.lambda_wfd
        epoch = int(getattr(self, "epoch", 0))
        scale = min(1.0, max(0.0, float(epoch + 1) / float(self.wfd_warmup_epochs)))
        return self.lambda_wfd * scale

    def _setup_wfd(self):
        student = unwrap_model(self.model)
        self.teacher_model = YOLO(self.teacher_path).model.to(self.device)
        self.teacher_model.eval()
        for p in self.teacher_model.parameters():
            p.requires_grad_(False)

        self.student_hooks = self._register_hooks(student, self.kd_layers)
        self.teacher_hooks = self._register_hooks(self.teacher_model, self.kd_layers)

        channel_pairs = self._infer_channel_pairs(student, self.teacher_model)
        adapters = []
        for student_c, teacher_c in channel_pairs:
            if student_c == teacher_c:
                adapters.append(nn.Identity())
            else:
                adapters.append(nn.Conv2d(student_c, teacher_c, kernel_size=1, bias=False))
        self.kd_adapters = nn.ModuleList(adapters).to(self.device)
        self.kd_adapters.train()

        adapter_params = [p for p in self.kd_adapters.parameters() if p.requires_grad]
        if adapter_params:
            base_group = {k: v for k, v in self.optimizer.param_groups[0].items() if k != "params"}
            base_group["params"] = adapter_params
            base_group.setdefault("initial_lr", base_group.get("lr", self.optimizer.param_groups[0].get("lr", 0.001)))
            self.optimizer.add_param_group(base_group)
            if self.scheduler is not None and hasattr(self.scheduler, "base_lrs"):
                self.scheduler.base_lrs.append(self.optimizer.param_groups[-1].get("initial_lr", self.optimizer.param_groups[-1]["lr"]))
                if hasattr(self.scheduler, "lr_lambdas") and self.scheduler.lr_lambdas:
                    self.scheduler.lr_lambdas.append(self.scheduler.lr_lambdas[0])

        self._original_student_loss = student.loss

        def wfd_loss(model_self, batch, preds=None):
            det_loss, det_items = self._original_student_loss(batch, preds)
            if self.teacher_model is None or self.kd_adapters is None:
                return det_loss, det_items
            self.teacher_model.eval()
            self.kd_adapters.train()
            with torch.no_grad():
                self.teacher_model(batch["img"])
            student_feats = _as_feature_list(self.student_hooks)
            teacher_feats = _as_feature_list(self.teacher_hooks)
            kd = feature_kd_loss(student_feats, teacher_feats, self.kd_adapters)
            wfd = wavelet_distill_loss(student_feats, teacher_feats, self.kd_adapters, alpha=self.wfd_alpha)
            total = det_loss + self.lambda_kd * kd + self._current_wfd_weight() * wfd
            return total, det_items

        student.loss = types.MethodType(wfd_loss, student)
        LOGGER.info(
            "YOLO26 WFD enabled: teacher=%s, layers=%s, channel_pairs=%s, lambda_kd=%.4f, lambda_wfd=%.4f, alpha=%.4f, warmup=%s",
            self.teacher_path,
            self.kd_layers,
            channel_pairs,
            self.lambda_kd,
            self.lambda_wfd,
            self.wfd_alpha,
            self.wfd_warmup_epochs,
        )

    def final_eval(self):
        student = unwrap_model(self.model)
        if self._original_student_loss is not None:
            student.loss = self._original_student_loss
        return super().final_eval()

    def __del__(self):
        for hook in getattr(self, "student_hooks", []):
            hook.close()
        for hook in getattr(self, "teacher_hooks", []):
            hook.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="YOLO26 WFD training for Ultralytics detection models")
    parser.add_argument("--student", default="weights/yolo26n.pt")
    parser.add_argument("--teacher", default="outputs/weights/teacher_yolo26x_best.pt")
    parser.add_argument("--data", default="dataset/data.yaml")
    parser.add_argument("--imgsz", type=int, default=320)
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--batch", default="0.9")
    parser.add_argument("--device", default="0")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--lambda-kd", type=float, default=0.3)
    parser.add_argument("--lambda-wfd", type=float, default=0.2)
    parser.add_argument("--wfd-alpha", type=float, default=1.5)
    parser.add_argument("--wfd-warmup-epochs", type=int, default=10)
    parser.add_argument("--project", default="runs/exp")
    parser.add_argument("--name", default="wfd_yolo26n")
    parser.add_argument("--kd-layers", default="16,19,22")
    parser.add_argument("--cache", default=False)
    parser.add_argument("--exist-ok", action="store_true")
    return parser.parse_args()


def _batch_value(value: str):
    text = str(value).strip()
    number = float(text)
    return int(number) if number.is_integer() and number >= 1 else number


def _cache_value(value: str | bool):
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    if text in {"false", "0", "none", "no"}:
        return False
    if text in {"true", "1", "yes"}:
        return True
    return value


def main():
    args = parse_args()
    kd_layers = [int(x.strip()) for x in args.kd_layers.split(",") if x.strip()]

    for required in [args.student, args.teacher, args.data]:
        if not Path(required).exists():
            raise FileNotFoundError(required)

    overrides = {
        "model": args.student,
        "teacher": args.teacher,
        "data": args.data,
        "imgsz": args.imgsz,
        "epochs": args.epochs,
        "batch": _batch_value(args.batch),
        "device": args.device,
        "workers": args.workers,
        "lambda_kd": args.lambda_kd,
        "lambda_wfd": args.lambda_wfd,
        "wfd_alpha": args.wfd_alpha,
        "wfd_warmup_epochs": args.wfd_warmup_epochs,
        "project": args.project,
        "name": args.name,
        "kd_layers": kd_layers,
        "cache": _cache_value(args.cache),
        "exist_ok": args.exist_ok,
        "task": "detect",
        "mode": "train",
        "compile": False,
        "plots": True,
    }

    trainer = YOLO26WFDTrainer(overrides=overrides)
    trainer.train()


if __name__ == "__main__":
    main()
