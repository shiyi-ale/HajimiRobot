$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
Push-Location services/intelligence
try {
    & ../../.venv/Scripts/python.exe -m pytest -q
    if ($LASTEXITCODE -ne 0) { throw 'Backend tests failed.' }
} finally { Pop-Location }
& npm.cmd run test --prefix Web-Console
if ($LASTEXITCODE -ne 0) { throw 'Frontend behavior tests failed.' }
& npm.cmd run lint --prefix Web-Console
if ($LASTEXITCODE -ne 0) { throw 'Type checking failed.' }
& npm.cmd run build --prefix Web-Console
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
& .venv/Scripts/python.exe services/intelligence/benchmark.py --create-fixture --video .runtime/verification/motion-test.avi --output .runtime/verification/benchmark.json
if ($LASTEXITCODE -ne 0) { throw 'Motion benchmark failed.' }
