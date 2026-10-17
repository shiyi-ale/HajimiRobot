$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$runtime = Join-Path $root '.runtime'
New-Item -ItemType Directory -Force $runtime | Out-Null
if (Test-Path (Join-Path $runtime 'processes.json')) { throw 'Process manifest exists. Run scripts/stop.ps1 first.' }
foreach ($port in @(3000,3001,8001)) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw "Port $port is already in use." }
}
$python = Join-Path $root '.venv/Scripts/python.exe'
if (-not (Test-Path $python)) { throw 'Run scripts/setup.ps1 first.' }
$node = (Get-Command node.exe).Source
$started = @()
try {
    $specs = @(
        @{name='intelligence'; exe=$python; args='-m uvicorn hajimi.app:app --app-dir services/intelligence --host 127.0.0.1 --port 8001'; cwd=$root},
        @{name='backend'; exe=$node; args='--import tsx server/index.ts'; cwd=(Join-Path $root 'Web-Console')},
        @{name='frontend'; exe=$node; args='node_modules/vite/bin/vite.js --host 127.0.0.1 --port 3000'; cwd=(Join-Path $root 'Web-Console')}
    )
    foreach ($spec in $specs) {
        $proc = Start-Process -FilePath $spec.exe -ArgumentList $spec.args -WorkingDirectory $spec.cwd -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtime ($spec.name + '.out.log')) -RedirectStandardError (Join-Path $runtime ($spec.name + '.err.log'))
        $started += @{id=$proc.Id; name=$spec.name; started=$proc.StartTime.ToUniversalTime().ToString('o')}
        $started | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $runtime 'processes.json')
    }
    $started | ConvertTo-Json | Set-Content -Encoding UTF8 (Join-Path $runtime 'processes.json')
    $ready = $false
    for ($attempt=0; $attempt -lt 40; $attempt++) {
        try {
            $null = Invoke-RestMethod 'http://127.0.0.1:3000/api/v1/health' -TimeoutSec 2
            $ready = $true
            break
        } catch { Start-Sleep -Milliseconds 500 }
    }
    if (-not $ready) { throw 'Startup health check failed. Inspect .runtime/*.err.log.' }
    Write-Host 'Web Console: http://127.0.0.1:3000'
    Write-Host 'OpenAPI: http://127.0.0.1:8001/docs'
} catch {
    & (Join-Path $PSScriptRoot 'stop.ps1')
    throw
}
