"""Index user experiment outputs without moving or changing original checkpoints."""
import csv
import hashlib
import json
from pathlib import Path
import cv2

ROOT = Path(__file__).resolve().parents[2]
RECOMMENDED = 'wfd_yolo26n_from_x_b128_gpu5'

def catalog(root=ROOT):
    experiments = []
    for folder in sorted((root / 'yoloexp/exp').glob('*')):
        if not folder.is_dir():
            continue
        path = folder / 'results.csv'
        rows = list(csv.DictReader(path.open(encoding='utf-8-sig'))) if path.exists() else []
        rows = [{k.strip():v.strip() for k,v in r.items()} for r in rows]
        best = max(rows, key=lambda r: float(r.get('metrics/mAP50-95(B)', 0))) if rows else {}
        weights = []
        for checkpoint in sorted((folder / 'weights').glob('*.pt')):
            weights.append({'name': checkpoint.name, 'path': checkpoint.relative_to(root).as_posix(),
                            'size_bytes': checkpoint.stat().st_size,
                            'sha256': hashlib.sha256(checkpoint.read_bytes()).hexdigest()})
        experiments.append({'id':folder.name, 'role': 'WFD student' if 'wfd' in folder.name else 'teacher' if 'teacher' in folder.name else 'KD student' if 'kd_' in folder.name else 'baseline',
                            'recommended':folder.name == RECOMMENDED, 'completed_epochs':len(rows),
                            'best_validation_epoch': int(best['epoch']) if best else None,
                            'best_validation_map50':float(best.get('metrics/mAP50(B)',0)),
                            'best_validation_map50_95':float(best.get('metrics/mAP50-95(B)',0)),
                            'weights': weights})
    videos = []
    for path in sorted((root/'yoloexp').glob('*')):
        if path.suffix.lower() not in ('.mp4','.avi','.mkv','.mov'):
            continue
        capture=cv2.VideoCapture(str(path))
        fps=capture.get(cv2.CAP_PROP_FPS)
        videos.append({'path':path.relative_to(root).as_posix(), 'name':path.name,
                       'width':int(capture.get(3)), 'height':int(capture.get(4)), 'fps':fps,
                       'duration_sec':capture.get(7)/fps if fps else 0})
        capture.release()
    return {'recommended_experiment':RECOMMENDED,'experiments':experiments,'videos':videos,
            'metric_note':'CSV training-validation metrics, not independently reproduced test-set mAP. Original experiments are preserved.'}

if __name__ == '__main__':
    result=catalog()
    (ROOT/'models').mkdir(exist_ok=True)
    (ROOT/'models/catalog.json').write_text(json.dumps(result,indent=2,ensure_ascii=False),encoding='utf-8')
    lines=['# 本地训练模型清单','', '原始目录 `yoloexp/exp` 保留不动。best.pt 用于推理；last.pt 保留用于恢复训练。SHA-256 与文件大小见 models/catalog.json。',
           '', '**默认部署 WFD 学生模型**：`yoloexp/exp/'+RECOMMENDED+'/weights/best.pt`，与项目 WFD 方案一致；并不声称其在本批验证日志中分数最高。',
           '', '| 实验 | 类型 | 日志 epoch 数 | 最佳验证 epoch | 验证 mAP50 | 验证 mAP50-95 | best.pt MB |',
           '|---|---|---:|---:|---:|---:|---:|']
    for e in result['experiments']:
        best=next((w for w in e['weights'] if w['name']=='best.pt'),None)
        lines.append(f"| {e['id']} | {e['role']} | {e['completed_epochs']} | {e['best_validation_epoch']} | {e['best_validation_map50']:.4f} | {e['best_validation_map50_95']:.4f} | {best['size_bytes']/1e6:.2f} |")
    lines+=['','数值来自各实验 results.csv 中 mAP50-95 最佳行，不是最后一行，也不是测试集复测。中途结束的实验和不同运行配置不应直接作为公平算法排名。',
            '这批训练验证日志不能直接证明简历中的 82.7% → 84.3% 测试结果，需用对应测试集及评估输出另行核对。', '', '## 本地视频']
    for v in result['videos']:
        lines.append(f"- `{v['path']}`：{v['width']}×{v['height']}，{v['fps']:.3f} FPS，{v['duration_sec']:.2f} 秒。")
    (ROOT/'docs/本地模型清单.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print(f"Indexed {len(result['experiments'])} experiments and {len(result['videos'])} videos.")
