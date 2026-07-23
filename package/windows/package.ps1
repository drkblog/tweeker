# Tweeker — Windows Packaging Script
# Run from repository root: powershell -ExecutionPolicy Bypass -File .\package\windows\package.ps1

$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..") | Select-Object -ExpandProperty Path

Write-Host "==> Packaging Tweeker app for Windows..."
Write-Host "Project Root: $ProjectRoot"

Set-Location $ProjectRoot

# Check for cargo tauri
$TauriCmd = "cargo"
$TauriArgs = @("tauri", "build")

try {
    $null = cargo tauri --version 2>$null
} catch {
    Write-Host "Tauri CLI not found in cargo. Trying npx @tauri-apps/cli..."
    try {
        $null = npx @tauri-apps/cli --version 2>$null
        $TauriCmd = "npx"
        $TauriArgs = @("@tauri-apps/cli", "build")
    } catch {
        Write-Host "Error: Neither cargo-tauri nor npx could be found. Please install tauri-cli first."
        exit 1
    }
}

Write-Host "==> Running production build..."
& $TauriCmd $TauriArgs

$BundleDir = Join-Path $ProjectRoot "src-tauri\target\release\bundle"
$DistDir = Join-Path $ProjectRoot "dist\windows"

Write-Host "==> Preparing output directory at $DistDir..."
New-Item -ItemType Directory -Force -Path $DistDir | Out-Null

# Clean previous artifacts
Remove-Item -Recurse -Force "$DistDir\*" -ErrorAction SilentlyContinue

$Copied = $false

# Copy MSI installer
$MsiDir = Join-Path $BundleDir "msi"
if (Test-Path $MsiDir) {
    $MsiFiles = Get-ChildItem -Path $MsiDir -Filter "*.msi" -ErrorAction SilentlyContinue
    if ($MsiFiles) {
        Write-Host "Copying MSI installer(s)..."
        Copy-Item $MsiFiles.FullName -Destination $DistDir
        $Copied = $true
    }
}

# Copy NSIS installer
$NsisDir = Join-Path $BundleDir "nsis"
if (Test-Path $NsisDir) {
    $ExeFiles = Get-ChildItem -Path $NsisDir -Filter "*.exe" -ErrorAction SilentlyContinue
    if ($ExeFiles) {
        Write-Host "Copying NSIS installer(s)..."
        Copy-Item $ExeFiles.FullName -Destination $DistDir
        $Copied = $true
    }
}

if ($Copied) {
    Write-Host "==> Packaging succeeded!"
    Write-Host "Artifacts are available in: $DistDir"
    Get-ChildItem $DistDir | Format-Table Name, Length -AutoSize
} else {
    Write-Host "Error: Production build failed and no bundles were generated."
    exit 1
}
