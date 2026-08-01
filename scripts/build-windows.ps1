param(
    [ValidatePattern("^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$")]
    [string]$Version = "1.0.1",

    [switch]$SkipDependencyInstall
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Step {
    param([Parameter(Mandatory)][string]$Message)

    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Assert-File {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Description
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Description was not found: $Path"
    }
}

function Assert-Directory {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Description
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "$Description was not found: $Path"
    }
}

$ProjectRoot = (
    Resolve-Path (
        Join-Path $PSScriptRoot ".."
    )
).Path

$PythonExe = Join-Path $ProjectRoot "backend\.venv\Scripts\python.exe"
$FrontendDirectory = Join-Path $ProjectRoot "frontend"
$FrontendDist = Join-Path $FrontendDirectory "dist"
$LauncherFile = Join-Path $ProjectRoot "desktop\launcher.py"
$BackendFile = Join-Path $ProjectRoot "backend\main.py"
$SyncthingExe = Join-Path $ProjectRoot "vendor\syncthing\syncthing.exe"
$SpecFile = Join-Path $ProjectRoot "scripts\OpenUIHub.spec"
$BuildDirectory = Join-Path $ProjectRoot "build\pyinstaller"
$ReleaseDirectory = Join-Path $ProjectRoot "release-dist"
$ApplicationDirectory = Join-Path $ReleaseDirectory "OpenUIHub"
$ApplicationExe = Join-Path $ApplicationDirectory "OpenUIHub.exe"
$PortableZip = Join-Path $ReleaseDirectory "OpenUI-Hub-Portable-v$Version.zip"
$ChecksumsFile = Join-Path $ReleaseDirectory "SHA256SUMS.txt"

Write-Step "Validating build inputs"

Assert-File -Path $PythonExe -Description "Backend virtual-environment Python"
Assert-File -Path $LauncherFile -Description "OpenUI launcher"
Assert-File -Path $BackendFile -Description "FastAPI backend"
Assert-File -Path $SyncthingExe -Description "Bundled Syncthing executable"
Assert-File -Path $SpecFile -Description "PyInstaller specification"
Assert-Directory -Path $FrontendDirectory -Description "Frontend directory"

Write-Step "Building the React production frontend"

Push-Location $FrontendDirectory

try {
    if (-not $SkipDependencyInstall) {
        npm ci

        if ($LASTEXITCODE -ne 0) {
            throw "npm ci failed."
        }
    }

    npm run build

    if ($LASTEXITCODE -ne 0) {
        throw "The React production build failed."
    }
}
finally {
    Pop-Location
}

Assert-File `
    -Path (Join-Path $FrontendDist "index.html") `
    -Description "React production entry point"

Write-Step "Installing the Windows packaging toolchain"

if (-not $SkipDependencyInstall) {
    & $PythonExe -m pip install --upgrade pip

    if ($LASTEXITCODE -ne 0) {
        throw "pip upgrade failed."
    }

    & $PythonExe -m pip install --upgrade pyinstaller

    if ($LASTEXITCODE -ne 0) {
        throw "PyInstaller installation failed."
    }
}

Write-Step "Checking Python source files"

& $PythonExe -m py_compile $LauncherFile $BackendFile

if ($LASTEXITCODE -ne 0) {
    throw "Python source validation failed."
}

Write-Step "Cleaning previous Windows build output"

Remove-Item `
    -LiteralPath $BuildDirectory `
    -Recurse `
    -Force `
    -ErrorAction SilentlyContinue

Remove-Item `
    -LiteralPath $ReleaseDirectory `
    -Recurse `
    -Force `
    -ErrorAction SilentlyContinue

New-Item `
    -ItemType Directory `
    -Path $ReleaseDirectory `
    -Force |
    Out-Null

Write-Step "Building OpenUIHub.exe with PyInstaller"

& $PythonExe -m PyInstaller `
    --noconfirm `
    --clean `
    --workpath $BuildDirectory `
    --distpath $ReleaseDirectory `
    $SpecFile

if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller failed to build OpenUI Hub."
}

Assert-File `
    -Path $ApplicationExe `
    -Description "Packaged OpenUI Hub executable"

Write-Step "Creating the portable Windows package"

Remove-Item `
    -LiteralPath $PortableZip `
    -Force `
    -ErrorAction SilentlyContinue

Compress-Archive `
    -Path $ApplicationDirectory `
    -DestinationPath $PortableZip `
    -CompressionLevel Optimal

Assert-File `
    -Path $PortableZip `
    -Description "Portable OpenUI Hub archive"

Write-Step "Writing SHA256 checksums"

$ExecutableHash = (
    Get-FileHash `
        -LiteralPath $ApplicationExe `
        -Algorithm SHA256
).Hash.ToLowerInvariant()

$PortableHash = (
    Get-FileHash `
        -LiteralPath $PortableZip `
        -Algorithm SHA256
).Hash.ToLowerInvariant()

$ChecksumLines = @(
    "$ExecutableHash  OpenUIHub\OpenUIHub.exe"
    "$PortableHash  $(Split-Path $PortableZip -Leaf)"
)

[System.IO.File]::WriteAllLines(
    $ChecksumsFile,
    $ChecksumLines,
    [System.Text.UTF8Encoding]::new($false)
)

Write-Step "Windows package completed successfully"

Write-Host "Application folder:" -ForegroundColor Green
Write-Host "  $ApplicationDirectory"
Write-Host "Portable archive:" -ForegroundColor Green
Write-Host "  $PortableZip"
Write-Host "Checksums:" -ForegroundColor Green
Write-Host "  $ChecksumsFile"
Write-Host ""
Write-Host "Test the executable with:" -ForegroundColor Yellow
Write-Host "  `"$ApplicationExe`""
