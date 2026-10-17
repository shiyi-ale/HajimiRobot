import json
import os
from unittest.mock import patch
import httpx
import pytest
from fastapi.testclient import TestClient
from hajimi.app import create_app
from hajimi.settings import Settings, DeepSeekConfig
from hajimi.nvr import YoloAdapter

def test_deepseek_key_is_private_persistent_and_clearable(tmp_path,monkeypatch):
    monkeypatch.delenv('LLM_API_KEY',raising=False)
    monkeypatch.delenv('DEEPSEEK_API_KEY',raising=False)
    settings=Settings(tmp_path)
    assert settings.public()['model']=='deepseek-flash'
    key='sk-test-DO-NOT-USE'
    public=settings.update(DeepSeekConfig(api_key=key))
    assert public['configured'] and key not in json.dumps(public)
    assert key not in settings.path.read_text()
    assert Settings(tmp_path).snapshot()['api_key']==key
    settings.update(DeepSeekConfig(model='deepseek-v4-pro'))
    assert settings.snapshot()['api_key']==key
    assert settings.update(DeepSeekConfig(clear_key=True))['configured'] is False

def test_settings_api_and_model_list(tmp_path,monkeypatch):
    monkeypatch.delenv('HAJIMI_API_TOKEN',raising=False)
    monkeypatch.delenv('DEEPSEEK_API_KEY',raising=False)
    monkeypatch.delenv('LLM_API_KEY',raising=False)
    with TestClient(create_app(tmp_path)) as c:
        assert c.post('/api/v1/agent/config/test').status_code==400
        r=c.put('/api/v1/agent/config',json={'api_key':'test-private-key','model':'deepseek-flash'})
        assert r.status_code==200 and 'test-private-key' not in r.text
        assert 'test-private-key' not in c.get('/api/v1/agent/config').text
        assert c.get('/api/v1/health').json()['llm_configured']
        def get(url,**kwargs):
            assert url=='https://api.deepseek.com/models'
            assert kwargs['headers']['Authorization']=='Bearer test-private-key'
            return httpx.Response(200,json={'data':[{'id':'deepseek-flash'}]},request=httpx.Request('GET',url))
        monkeypatch.setattr(httpx,'get',get)
        assert c.post('/api/v1/agent/config/test').json()['selected_available']
        c.put('/api/v1/agent/config',json={'clear_key':True})
        assert not c.get('/api/v1/health').json()['llm_configured']

def test_gpu_request_never_silently_falls_back(tmp_path,monkeypatch):
    import sys
    from types import SimpleNamespace
    torch=SimpleNamespace(cuda=SimpleNamespace(is_available=lambda:False,device_count=lambda:0))
    monkeypatch.setitem(sys.modules,'torch',torch)
    weights=tmp_path/'best.pt'; weights.write_bytes(b'test-file-not-a-model')
    with patch.object(torch.cuda,'is_available',return_value=False):
        with pytest.raises(RuntimeError,match='CUDA'):
            YoloAdapter(str(weights),.4,device='cuda:0')

def test_deepseek_request_and_json_result(tmp_path,monkeypatch):
    from hajimi.agent import Agent
    from hajimi.store import Store
    from hajimi.models import Question
    settings=Settings(tmp_path)
    settings.update(DeepSeekConfig(api_key='test-private-key'))
    agent=Agent(Store(tmp_path),settings)
    def post(url,**kwargs):
        assert url=='https://api.deepseek.com/chat/completions'
        assert kwargs['json']['thinking']=={'type':'disabled'}
        assert kwargs['json']['model']=='deepseek-flash'
        return httpx.Response(200,json={'choices':[{'message':{'content':json.dumps({'summary':'缺少有效观测，无法判断趋势','findings':[],'limitations':['观测不足']})}}]},request=httpx.Request('POST',url))
    monkeypatch.setattr(httpx,'post',post)
    monkeypatch.delenv('EMBEDDING_API_KEY',raising=False)
    report=agent.run(Question(date='2026-03-01',source='test'))
    assert report['mode']=='llm'
    assert 'test-private-key' not in json.dumps(report,ensure_ascii=False)
