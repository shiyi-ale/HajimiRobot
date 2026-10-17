import importlib.util
from pathlib import Path

spec=importlib.util.spec_from_file_location('release_check',Path(__file__).resolve().parents[3]/'scripts/check_release.py')
check=importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


def test_release_scanner_blocks_secrets_and_artifacts():
    secret=b'never-publish-this-fixture-value'
    assert check.inspect_blob('docs/example.md',secret,[secret])[0][2]=='exact-local-credential'
    assert check.inspect_blob('.env.local',b'KEY=fixture',[])[0][2]=='private-artifact'
    assert check.inspect_blob('models/private.pt',b'fixture',[])[0][2]=='private-artifact'
    value=('sk-'+'a'*32).encode()
    findings=check.inspect_blob('config.txt',value,[])
    assert findings[0][2]=='credential'
    assert value.decode() not in repr(findings)
    assert check.inspect_blob('.env.example',b'DEEPSEEK_API_KEY=\n',[])==[]
