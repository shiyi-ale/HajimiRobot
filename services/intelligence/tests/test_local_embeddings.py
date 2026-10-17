import sys
from types import SimpleNamespace

import numpy as np

from hajimi.embeddings import Embeddings, memory_text
from hajimi.agent import Agent
from hajimi.store import Store


def test_local_embeddings_cpu_and_distinct_query_path(tmp_path, monkeypatch):
    monkeypatch.setenv('EMBEDDING_BACKEND', 'local')
    calls = []

    class Encoder:
        def __init__(self, **kwargs):
            calls.append(kwargs)

        def query_embed(self, text):
            calls.append(('query', text))
            return iter([np.array([1., 0.])])

        def passage_embed(self, texts):
            calls.append(('passage', texts))
            return iter([np.array([0., 1.])])

    monkeypatch.setitem(sys.modules, 'fastembed', SimpleNamespace(TextEmbedding=Encoder))
    embeddings = Embeddings(tmp_path)
    assert embeddings.configured
    assert embeddings.encode('问题', query=True) == [1., 0.]
    assert embeddings.encode('记忆') == [0., 1.]
    assert calls[0]['providers'] == ['CPUExecutionProvider']
    assert len([c for c in calls if isinstance(c, dict)]) == 1


def test_embedding_change_invalidates_clean_memories(tmp_path, monkeypatch):
    monkeypatch.setenv('EMBEDDING_BACKEND', 'local')
    store = Store(tmp_path)
    Agent(store)
    store.execute('INSERT INTO memories VALUES(?,?,?,?,?,?)', ('id', '2026-01-01', 'primary', 'test', '{}', 0))
    Agent(store)
    assert store.rows('SELECT dirty FROM memories')[0]['dirty'] == 0
    monkeypatch.setenv('LOCAL_EMBEDDING_MODEL', 'different-model')
    Agent(store)
    assert store.rows('SELECT dirty FROM memories')[0]['dirty'] == 1
    store.db.close()


def test_memory_text_is_short_and_keeps_chinese_behavior_evidence(tmp_path):
    store = Store(tmp_path)
    text = memory_text(store.stats('2026-01-01', 'primary', 'test'))
    assert '无观测' in text and '来源 test' in text
    assert len(text) < 1000
    store.db.close()
