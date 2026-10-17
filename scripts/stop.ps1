$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$manifest = Join-Path $root '.runtime/processes.json'
if (-not (Test-Path $manifest)) { Write-Host 'No managed processes.'; exit 0 }
$entries = Get-Content $manifest -Raw | ConvertFrom-Json
# Request pipeline shutdown first so FFmpeg can finalize MP4s.
try {
    $status = Invoke-RestMethod 'http://127.0.0.1:3001/api/v1/nvr/status' -TimeoutSec 3
    foreach ($camera in $status.pipelines.PSObject.Properties.Name) {
        Invoke-RestMethod -Method Post "http://127.0.0.1:3001/api/v1/cameras/$camera/stop" -TimeoutSec 45 | Out-Null
    }
} catch { Write-Host 'Service unavailable; stopping managed processes.' }
foreach ($entry in $entries) {
    $proc = Get-Process -Id $entry.id -ErrorAction SilentlyContinue
    if ($proc -and [Math]::Abs(($proc.StartTime.ToUniversalTime() - [datetime]::Parse($entry.started).ToUniversalTime()).TotalSeconds) -lt 2) {
        Stop-Process -Id $entry.id
    }
}
Remove-Item -LiteralPath $manifest
Write-Host 'Managed services stopped.'
