$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$PythonExe = Join-Path $ProjectRoot "backend\.venv\Scripts\python.exe"
$Frontend = Join-Path $ProjectRoot "frontend"

if (-not (Test-Path $PythonExe -PathType Leaf)) {
    throw "Python virtual environment was not found: $PythonExe"
}

Write-Host "Validating Python files..." -ForegroundColor Cyan
& $PythonExe -m py_compile `
    (Join-Path $ProjectRoot "backend\main.py") `
    (Join-Path $ProjectRoot "backend\version.py") `
    (Join-Path $ProjectRoot "desktop\launcher.py")

if ($LASTEXITCODE -ne 0) {
    throw "Python validation failed."
}

Write-Host "Building frontend..." -ForegroundColor Cyan
Push-Location $Frontend
try {
    npm ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed." }

    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed." }
}
finally {
    Pop-Location
}

Write-Host "Source validation completed successfully." -ForegroundColor Green
