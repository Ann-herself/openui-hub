param(
    [ValidatePattern("^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$")]
    [string]$Version = "1.0.0"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest


function Write-Step {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}


$ProjectRoot = (
    Resolve-Path (
        Join-Path $PSScriptRoot ".."
    )
).Path

$InstallerScript = Join-Path `
    $ProjectRoot `
    "installer\OpenUIHub.iss"

$ApplicationExe = Join-Path `
    $ProjectRoot `
    "release-dist\OpenUIHub\OpenUIHub.exe"

$SetupExe = Join-Path `
    $ProjectRoot `
    "release-dist\OpenUI-Hub-Setup-v$Version.exe"

$ChecksumsFile = Join-Path `
    $ProjectRoot `
    "release-dist\SHA256SUMS.txt"


$CandidatePaths = @()

if (${env:ProgramFiles(x86)}) {
    $CandidatePaths += Join-Path `
        ${env:ProgramFiles(x86)} `
        "Inno Setup 6\ISCC.exe"
}

if ($env:ProgramFiles) {
    $CandidatePaths += Join-Path `
        $env:ProgramFiles `
        "Inno Setup 6\ISCC.exe"
}

if ($env:LOCALAPPDATA) {
    $CandidatePaths += Join-Path `
        $env:LOCALAPPDATA `
        "Programs\Inno Setup 6\ISCC.exe"
}


$IsccExe = $CandidatePaths |
    Where-Object {
        Test-Path `
            -LiteralPath $_ `
            -PathType Leaf
    } |
    Select-Object -First 1

if (-not $IsccExe) {
    $PathResult = Get-Command `
        "ISCC.exe" `
        -ErrorAction SilentlyContinue

    if ($PathResult) {
        $IsccExe = $PathResult.Source
    }
}


if (-not $IsccExe) {
    throw @"
Inno Setup 6 was not found.

Install Inno Setup, then run this script again.
Expected compiler: ISCC.exe
"@
}


if (-not (
    Test-Path `
        -LiteralPath $InstallerScript `
        -PathType Leaf
)) {
    throw "Installer script was not found: $InstallerScript"
}


if (-not (
    Test-Path `
        -LiteralPath $ApplicationExe `
        -PathType Leaf
)) {
    throw @"
OpenUIHub.exe was not found.

Build the Windows application first:
.\scripts\build-windows.ps1 -Version $Version
"@
}


Write-Step "Using Inno Setup compiler"
Write-Host "  $IsccExe"


Write-Step "Compiling the OpenUI Hub installer"

& $IsccExe `
    "/DMyAppVersion=$Version" `
    $InstallerScript

if ($LASTEXITCODE -ne 0) {
    throw "Inno Setup failed to create the installer."
}


if (-not (
    Test-Path `
        -LiteralPath $SetupExe `
        -PathType Leaf
)) {
    throw "Installer output was not found: $SetupExe"
}


Write-Step "Updating SHA256 checksums"

$SetupHash = (
    Get-FileHash `
        -LiteralPath $SetupExe `
        -Algorithm SHA256
).Hash.ToLowerInvariant()

$ExistingLines = @()

if (
    Test-Path `
        -LiteralPath $ChecksumsFile `
        -PathType Leaf
) {
    $ExistingLines = @(
        Get-Content `
            -LiteralPath $ChecksumsFile |
        Where-Object {
            $_ -notmatch "OpenUI-Hub-Setup-v.*\.exe$"
        }
    )
}

$SetupFileName = Split-Path `
    $SetupExe `
    -Leaf

$SetupLine = "$SetupHash  $SetupFileName"

$UpdatedLines = @($ExistingLines) + $SetupLine

$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)

[System.IO.File]::WriteAllLines(
    $ChecksumsFile,
    [string[]]$UpdatedLines,
    $Utf8NoBom
)


Write-Step "Installer completed successfully"

Write-Host "Installer:" -ForegroundColor Green
Write-Host "  $SetupExe"

Write-Host "Checksums:" -ForegroundColor Green
Write-Host "  $ChecksumsFile"
