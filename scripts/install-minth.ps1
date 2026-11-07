<#PSScriptInfo
.VERSION 1.0.0
.GUID 9b2f8c7a-4e1d-4a3b-9c2e-7f8a1d6e3b4c
.AUTHOR MINT Harness
.COPYRIGHT (c) 2026
.TAGS mint, harness, bun, cli, shim
.LICENSEURI https://opensource.org/licenses/MIT
.PROJECTURI https://github.com/VishruthC/mint-harness
.RELEASENOTES
Initial installer for minth global shim.
#>

<#
.SYNOPSIS
    Installs or repairs the global `minth` shim for MINT Harness.

.DESCRIPTION
    This script regenerates the `minth.cmd` shim in Bun's global bin directory.
    The shim keeps MINT's config and source code rooted at the repository path,
    but passes the caller's working directory via MINT_WORKSPACE so the harness
    operates on the directory it is launched from.

    Run this after any `bun link`, `bun install -g`, or global reinstall that
    may have overwritten the shim with a hardcoded --cwd.

.NOTES
    Requires Bun in PATH.
    The repository path is auto-detected from this script's location.
#>

#Requires -Version 5.1

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [switch]$Force,

    [Parameter(Mandatory = $false)]
    [string]$BunBinDir
)

$ErrorActionPreference = 'Stop'

# Locate repository root from this script's location
$scriptDir = $PSScriptRoot
$repoRoot = Split-Path $scriptDir -Parent

if (-not (Test-Path (Join-Path $repoRoot 'package.json'))) {
    Write-Error "Could not find package.json in $repoRoot"
    exit 1
}

# Resolve Bun global bin directory
if (-not $BunBinDir) {
    $bunCmd = Get-Command bun -ErrorAction SilentlyContinue
    if (-not $bunCmd) {
        Write-Error "Bun not found in PATH. Install Bun from https://bun.sh"
        exit 1
    }
    $BunBinDir = Join-Path (Split-Path $bunCmd.Source -Parent) 'bin'
}

if (-not (Test-Path $BunBinDir)) {
    Write-Error "Bun global bin directory not found: $BunBinDir"
    exit 1
}

$shimPath = Join-Path $BunBinDir 'minth.cmd'
$repoRootEscaped = $repoRoot -replace '\\', '\\'

$shimContent = @"
@echo off
setlocal
set "MINT_WORKSPACE=%CD%"
bun --cwd "$repoRootEscaped" src/index.tsx %*
endlocal & exit /b %ERRORLEVEL%
"@

if (Test-Path $shimPath -and -not $Force) {
    $existing = Get-Content -Raw $shimPath
    if ($existing -eq $shimContent) {
        Write-Host "Shim is already up to date: $shimPath" -ForegroundColor Green
        exit 0
    }
    Write-Warning "Existing shim differs. Use -Force to overwrite."
    Write-Host "Current:" -ForegroundColor Yellow
    Write-Host $existing
    Write-Host "Proposed:" -ForegroundColor Cyan
    Write-Host $shimContent
    exit 1
}

Write-Host "Writing shim to $shimPath" -ForegroundColor Cyan
Set-Content -Path $shimPath -Value $shimContent -Encoding ascii -NoNewline

Write-Host "Shim installed successfully." -ForegroundColor Green
Write-Host "The `minth` command will now operate on the directory you launch it from." -ForegroundColor Cyan
Write-Host "MINT's own config (.env, sessions) remains in $repoRoot" -ForegroundColor Gray