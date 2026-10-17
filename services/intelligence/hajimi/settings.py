"""Server-only model configuration. Keys never appear in public settings responses."""
import base64
import json
import os
import threading
from pathlib import Path
import httpx
from pydantic import BaseModel, Field, SecretStr

class DeepSeekConfig(BaseModel):
    model: str = Field(default='deepseek-flash', min_length=1, max_length=100, pattern=r'^[a-zA-Z0-9._:/-]+$')
    api_key: SecretStr = SecretStr('')
    clear_key: bool = False

class Settings:
    def __init__(self, root):
        self.path = Path(root) / 'agent-settings.json'
        self.lock = threading.RLock()

    def snapshot(self):
        with self.lock:
            if self.path.exists():
                data = json.loads(self.path.read_text(encoding='utf-8'))
                secret = data.get('protected_key', '')
                if secret:
                    raw = base64.b64decode(secret)
                    if data.get('protection') == 'windows-dpapi':
                        import win32crypt
                        raw = win32crypt.CryptUnprotectData(raw, None, None, None, 0)[1]
                    key = raw.decode('utf-8')
                else:
                    key = ''
                return {'provider': 'deepseek', 'base_url': 'https://api.deepseek.com', 'model': data['model'], 'api_key': key}
        # Preserve explicitly configured compatible providers and existing tests.
        if os.getenv('LLM_API_KEY') and os.getenv('LLM_MODEL'):
            return {'provider': 'compatible', 'base_url': os.getenv('LLM_BASE_URL', 'https://api.openai.com/v1').rstrip('/'),
                    'model': os.environ['LLM_MODEL'], 'api_key': os.environ['LLM_API_KEY']}
        return {'provider': 'deepseek', 'base_url': 'https://api.deepseek.com',
                'model': os.getenv('DEEPSEEK_MODEL') or 'deepseek-flash', 'api_key': os.getenv('DEEPSEEK_API_KEY', '')}

    def public(self):
        config = self.snapshot()
        return {k:v for k,v in config.items() if k != 'api_key'} | {'configured': bool(config['api_key']), 'saved': self.path.exists()}

    def update(self, config):
        with self.lock:
            previous = self.snapshot()
            incoming = config.api_key.get_secret_value().strip()
            if len(incoming) > 1024 or any(c.isspace() for c in incoming):
                raise ValueError('API Key 格式无效')
            key = '' if config.clear_key else (incoming or previous['api_key'])
            protection = 'local-file'
            raw = key.encode('utf-8')
            if os.name == 'nt' and key:
                import win32crypt
                raw = win32crypt.CryptProtectData(raw, 'Hajimi DeepSeek key', None, None, None, 0)
                protection = 'windows-dpapi'
            payload = {'model': config.model, 'protection': protection,
                       'protected_key': base64.b64encode(raw).decode('ascii') if key else ''}
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temp = self.path.with_suffix('.tmp')
            temp.write_text(json.dumps(payload), encoding='utf-8')
            if os.name != 'nt':
                temp.chmod(0o600)
            temp.replace(self.path)
        return self.public()

    def test(self):
        config = self.snapshot()
        if not config['api_key']:
            raise ValueError('请先输入并保存 DeepSeek API Key')
        response = httpx.get(config['base_url'] + '/models',
                            headers={'Authorization': 'Bearer ' + config['api_key']}, timeout=15)
        response.raise_for_status()
        models = [m['id'] for m in response.json().get('data', [])]
        return {'ok': True, 'models': models, 'selected_available': config['model'] in models}
