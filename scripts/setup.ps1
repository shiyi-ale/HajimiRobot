param([switch]$SkipYolo, [switch]$CpuOnly)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
if (-not (Test-Path '.venv/Scripts/python.exe')) {
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.11+ is required.' }
}
& .venv/Scripts/python.exe -m pip install -r services/intelligence/requirements.lock.txt
if ($LASTEXITCODE -ne 0) { throw 'Python dependency installation failed.' }
& .venv/Scripts/python.exe -m pip install -r services/intelligence/requirements-embedding.txt
if ($LASTEXITCODE -ne 0) { throw 'Local embedding dependency installation failed.' }
if (-not $SkipYolo) {
    if ($CpuOnly) {
        & .venv/Scripts/python.exe -m pip install torch==2.11.0 torchvision==0.26.0 --index-url https://download.pytorch.org/whl/cpu
    } else {
        & .venv/Scripts/python.exe -m pip install torch==2.11.0 torchvision==0.26.0 --index-url https://download.pytorch.org/whl/cu128
    }
    if ($LASTEXITCODE -ne 0) { throw 'PyTorch installation failed.' }
    & .venv/Scripts/python.exe -m pip install -r services/intelligence/requirements-yolo.txt
    if ($LASTEXITCODE -ne 0) { throw 'YOLO dependency installation failed.' }
}
& npm.cmd ci --prefix Web-Console
if ($LASTEXITCODE -ne 0) { throw 'npm installation failed.' }
if (-not (Test-Path '.env.local')) { Copy-Item '.env.example' '.env.local' }
if (-not (Test-Path 'Web-Console/.env.local')) { Copy-Item 'Web-Console/.env.example' 'Web-Console/.env.local' }
& .venv/Scripts/python.exe -c "import imageio_ffmpeg; print('FFmpeg:', imageio_ffmpeg.get_ffmpeg_exe())"
Write-Host 'Ready. Run: powershell -ExecutionPolicy Bypass -File scripts/start.ps1'
