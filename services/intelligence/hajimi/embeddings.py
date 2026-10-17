"""CPU-local embeddings, with an optional compatible remote API."""
import os
import threading
from pathlib import Path

import httpx


class Embeddings:
    def __init__(self, root):
        self.root = Path(root)
        self.model = None
        self.lock = threading.RLock()

    @property
    def backend(self):
        return os.getenv('EMBEDDING_BACKEND', 'api').lower()

    @property
    def model_name(self):
        if self.backend == 'local':
            return os.getenv('LOCAL_EMBEDDING_MODEL', 'BAAI/bge-small-zh-v1.5')
        return os.getenv('EMBEDDING_MODEL', '')

    @property
    def configured(self):
        return self.backend == 'local' or bool(os.getenv('EMBEDDING_API_KEY') and self.model_name)

    @property
    def identity(self):
        # Changing memory text formatting also requires a new vector collection.
        origin = 'cpu:memory-text-v1:' if self.backend == 'local' else os.getenv('EMBEDDING_BASE_URL', 'https://api.openai.com/v1')
        return origin + self.model_name

    def encode(self, text, query=False):
        if self.backend == 'local':
            with self.lock:
                if self.model is None:
                    from fastembed import TextEmbedding
                    self.model = TextEmbedding(
                        model_name=self.model_name,
                        cache_dir=os.getenv('LOCAL_EMBEDDING_CACHE', str(self.root / 'embedding-models')),
                        threads=int(os.getenv('LOCAL_EMBEDDING_THREADS', '2')),
                        providers=['CPUExecutionProvider'],
                        local_files_only=os.getenv('LOCAL_EMBEDDING_OFFLINE', '0') == '1',
                    )
                vectors = self.model.query_embed(text) if query else self.model.passage_embed([text])
                return next(iter(vectors)).tolist()
        if not self.configured:
            raise RuntimeError('未配置嵌入服务，使用 SQLite 结构化检索')
        origin = os.getenv('EMBEDDING_BASE_URL', 'https://api.openai.com/v1').rstrip('/')
        response = httpx.post(origin + '/embeddings',
                              headers={'Authorization': 'Bearer ' + os.getenv('EMBEDDING_API_KEY', '')},
                              json={'model': self.model_name, 'input': text}, timeout=30)
        response.raise_for_status()
        return response.json()['data'][0]['embedding']


def memory_text(stats):
    """Short bilingual evidence fits the encoder; full evidence remains in payload."""
    labels = {'eating': '进食', 'playing': '玩耍活动', 'rest': '休息',
              'sitting': '坐立', 'stretching': '伸展', 'yawning': '打哈欠'}
    observed = stats['observed_sec']
    parts = [f"宠物行为记忆 {stats['date']} 摄像头 {stats['camera_id']} 来源 {stats['source']}",
             f"样本 {stats['sample_count']} 观测 {observed:.0f} 秒 覆盖率 {stats['coverage']:.1%}"]
    for label, seconds in stats['duration_sec'].items():
        parts.append(f"{labels.get(label, label)} {label}: {seconds:.0f}秒 占比 {seconds / observed:.1%}" if observed else f"{label}: 无观测")
    parts.append(f"进食片段 {stats['eating_episodes']} 投喂指令 {stats['feeding_commands']}")
    return '；'.join(parts)
