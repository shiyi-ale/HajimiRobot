"""Inspect staged or outgoing blobs. Never print matched credential values."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
BLOCKED = {'.pt','.pth','.onnx','.engine','.mp4','.avi','.mov','.mkv','.sqlite','.sqlite3','.db','.log','.pem','.key'}
RULES = {
    'credential': re.compile(r'(?:sk-[A-Za-z0-9_-]{28,}|gh[pousr]_[A-Za-z0-9]{25,}|github_pat_[A-Za-z0-9_]{25,}|AKIA[A-Z0-9]{16})'),
    'private-key': re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    'personal-path': re.compile(r'[A-Za-z]:[\\/]+Users[\\/]+[^\s\\/]+|[A-Za-z]:[\\/]+Hajimi-Robot[\\/]+', re.I),
    'embedded-auth': re.compile(r'https?://[^\s/@:]+:[^\s/@]+@'),
    'literal-secret': re.compile(r'''["']?\b(?:API_KEY|api_key|TOKEN|token|PASSWORD|password)\b["']?\s*[:=]\s*["'][A-Za-z0-9_+/=-]{32,}["']'''),
}


def git(*args):
    return subprocess.check_output(['git',*args],cwd=ROOT)


def local_secrets():
    """Read only configured project keys, in memory; no network or diagnostic echo."""
    try:
        from dotenv import dotenv_values
        values = dotenv_values(ROOT / '.env.local')
    except ImportError:
        values = {}
    secrets = [str(value).encode() for name,value in values.items() if value and ('API_KEY' in name or name.endswith('_TOKEN'))]
    keyfile = ROOT / '.runtime/intelligence/agent-settings.json'
    if keyfile.is_file():
        try:
            import base64
            data = json.loads(keyfile.read_text(encoding='utf-8'))
            value = base64.b64decode(data.get('protected_key',''))
            if value and data.get('protection') == 'windows-dpapi':
                import win32crypt
                value = win32crypt.CryptUnprotectData(value,None,None,None,0)[1]
            if value:
                secrets.append(value)
        except Exception:
            raise RuntimeError('Local saved-key check unavailable; run with the project Python environment') from None
    return [s for s in secrets if len(s)>=8]


def inspect_blob(name, blob, secrets):
    findings=[]
    path=Path(name)
    if (path.suffix.lower() in BLOCKED or '.runtime' in path.parts or '.venv' in path.parts
        or path.name=='agent-settings.json' or (path.name.startswith('.env') and not path.name.endswith('.example'))):
        findings.append((name,0,'private-artifact'))
    if any(secret in blob for secret in secrets):
        findings.append((name,0,'exact-local-credential'))
    try:
        text=blob.decode('utf-8-sig')
    except UnicodeError:
        return findings
    for number,line in enumerate(text.splitlines(),1):
        for rule,pattern in RULES.items():
            if pattern.search(line):
                findings.append((name,number,rule))
    return findings


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--staged',action='store_true')
    parser.add_argument('--commits',help='Inspect final blobs changed in BASE..HEAD')
    args=parser.parse_args()
    if not args.staged and not args.commits:
        parser.error('Choose --staged or --commits BASE..HEAD')
    if args.commits:
        before,after=args.commits.split('..',1)
        jobs=[]
        for commit in git('rev-list','--reverse',before+'..'+after).decode().split():
            names=git('diff-tree','--no-commit-id','--name-only','--diff-filter=ACMR','-r','-z',commit).decode().split('\0')
            jobs.extend((commit+':',name) for name in names if name)
    else:
        names=git('diff','--cached','--name-only','--diff-filter=ACMR','-z').decode().split('\0')
        jobs=[(':',name) for name in names if name]
    secrets=local_secrets()
    findings=[];count=0
    for revision,name in jobs:
        findings.extend(inspect_blob(name,git('show',revision+name),secrets));count+=1
    for name,line,rule in findings:
        print(f'{name}:{line}: {rule}')
    version=(ROOT/'VERSION').read_text().strip()
    package=json.loads((ROOT/'Web-Console/package.json').read_text())
    lock=json.loads((ROOT/'Web-Console/package-lock.json').read_text())
    if any(v!=version for v in [package['version'],lock['version'],lock['packages']['']['version']]):
        print('VERSION:0: metadata-mismatch');findings.append(('VERSION',0,'metadata-mismatch'))
    print(f'Inspected {count} blobs. Credential values are not printed. Findings: {len(findings)}.')
    return 1 if findings else 0


if __name__=='__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    raise SystemExit(main())
