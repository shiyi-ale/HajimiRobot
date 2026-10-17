from datetime import datetime, timezone
from typing import Literal
from pydantic import BaseModel, Field, field_validator, model_validator

Label = Literal['eating', 'playing', 'rest', 'sitting', 'stretching', 'yawning']
LABELS = ('eating', 'playing', 'rest', 'sitting', 'stretching', 'yawning')

def utcnow():
    return datetime.now(timezone.utc).isoformat()

class Box(BaseModel):
    label: Label
    confidence: float = Field(ge=0, le=1)
    xyxy: tuple[float, float, float, float]
    track_id: str | None = None

    @field_validator('xyxy')
    @classmethod
    def coordinates(cls, v):
        if not all(0 <= x <= 1 for x in v) or v[0] >= v[2] or v[1] >= v[3]:
            raise ValueError('xyxy must be normalized with x1<x2 and y1<y2')
        return v

class Detection(BaseModel):
    protocol_version: Literal['1.0'] = '1.0'
    device_id: str = Field(min_length=1, max_length=100)
    camera_id: str = Field(min_length=1, max_length=100)
    session_id: str = Field(min_length=1, max_length=100)
    frame_id: int = Field(ge=0)
    captured_at: datetime
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    model_id: str = Field(min_length=1, max_length=200)
    source: Literal['local-video', 'camera', 'test', 'legacy'] = 'camera'
    # Explicit valid observation interval; a sparse detection is not continuous coverage.
    observation_sec: float = Field(default=0, ge=0, le=5)
    boxes: list[Box] = Field(default_factory=list, max_length=100)

    @field_validator('captured_at')
    @classmethod
    def utc(cls, v):
        if v.tzinfo is None:
            raise ValueError('timezone required')
        return v.astimezone(timezone.utc)

class Batch(BaseModel):
    frames: list[Detection] = Field(min_length=1, max_length=200)

class Heartbeat(BaseModel):
    protocol_version: Literal['1.0'] = '1.0'
    device_id: str
    camera_id: str
    session_id: str
    captured_at: datetime
    stream_ok: bool
    inference_ok: bool
    scheduler_state: str
    observed_sec: float = Field(ge=0)
    error: str | None = None

    _utc = field_validator('captured_at')(Detection.utc.__func__)

class CameraConfig(BaseModel):
    revision: int = Field(default=1, ge=1)
    source: str = ''
    source_kind: Literal['local-video', 'camera'] = 'local-video'
    weights: str = ''
    inference_device: str = Field(default='cuda:0', pattern=r'^(cpu|cuda:[0-9]+)$')
    imgsz: int = Field(default=320, ge=160, le=1280, multiple_of=32)
    half: bool = True
    roi: list[tuple[float, float]] = Field(default_factory=lambda: [(0, 0), (1, 0), (1, 1), (0, 1)])
    analysis_fps: float = Field(default=5, gt=0, le=30)
    idle_fps: float = Field(default=.2, gt=0, le=5)
    candidate_fps: float = Field(default=1, gt=0, le=10)
    active_fps: float = Field(default=5, gt=0, le=30)
    rise_ratio: float = Field(default=.02, gt=0, le=1)
    fall_ratio: float = Field(default=.005, ge=0, lt=1)
    rise_sec: float = Field(default=.5, ge=0)
    fall_sec: float = Field(default=3, ge=0)
    warmup_sec: float = Field(default=3, ge=0)
    pre_sec: float = Field(default=5, ge=0, le=30)
    post_sec: float = Field(default=10, ge=0, le=60)
    retention_days: int = Field(default=7, ge=1)
    max_storage_bytes: int = Field(default=10_000_000_000, ge=1_000_000)
    confidence: float = Field(default=.4, ge=0, le=1)
    review_gap_sec: float = Field(default=10, ge=0, le=120)
    review_max_sec: float = Field(default=3600, ge=30, le=21600)

    @model_validator(mode='after')
    def validate_config(self):
        import cv2
        import numpy as np
        if len(self.roi) < 3 or len(self.roi) > 32 or any(not 0 <= x <= 1 for p in self.roi for x in p):
            raise ValueError('ROI requires 3..32 normalized points')
        if abs(cv2.contourArea(np.array(self.roi, dtype=np.float32))) < .001:
            raise ValueError('ROI area too small')
        if self.fall_ratio >= self.rise_ratio:
            raise ValueError('fall_ratio must be below rise_ratio')
        if not self.idle_fps <= self.candidate_fps <= self.active_fps <= self.analysis_fps:
            raise ValueError('require idle <= candidate <= active <= analysis FPS')
        return self

class Question(BaseModel):
    question: str = Field(default='生成当天行为报告', min_length=1, max_length=2000)
    date: str
    camera_id: str = 'primary'
    source: Literal['local-video', 'camera', 'test', 'legacy'] = 'local-video'

    @field_validator('date')
    @classmethod
    def valid_date(cls, v):
        from datetime import date
        date.fromisoformat(v)
        return v
