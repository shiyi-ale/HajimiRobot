$ErrorActionPreference = 'Stop'
$health = Invoke-RestMethod 'http://127.0.0.1:3000/api/v1/health' -TimeoutSec 5
$status = Invoke-RestMethod 'http://127.0.0.1:3000/api/v1/nvr/status' -TimeoutSec 5
$health | ConvertTo-Json -Depth 5
$status | ConvertTo-Json -Depth 5
