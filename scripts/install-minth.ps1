<#PSScriptInfo
.VERSION 1.1.0
.GUID 9b2f8c7a-4e1d-4a3b-9c2e-7f8a1d6e3b4c
.AUTHOR MINT Harness
.COPYRIGHT (c) 2026
.TAGS mint, harness, bun, cli, shim
.LICENSEURI https://opensource.org/licenses/MIT
.PROJECTURI https://github.com/VishruthC/mint-harness
.RELEASENOTES
Delegates to the cross-platform minth installer.
#>

<#
.SYNOPSIS
    Installs or repairs the global `minth` shim for MINT Harness.

.DESCRIPTION
    This PowerShell entry point delegates to scripts/install-minth.ts, which
    writes the platform-appropriate shim. The shim keeps MINT's config and
    source code rooted at the repository path, but passes the caller's working
    directory via MINT_WORKSPACE so the harness operates on the directory it is
    launched from.

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

$repoRoot = Split-Path $PSScriptRoot -Parent

if (-not (Test-Path (Join-Path $repoRoot 'package.json'))) {
    Write-Error "Could not find package.json in $repoRoot"
    exit 1
}

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Error "Bun not found in PATH. Install Bun from https://bun.sh"
    exit 1
}

$previousBunBin = $env:MINT_BUN_BIN
if ($BunBinDir) {
    $env:MINT_BUN_BIN = $BunBinDir
}

$exitCode = 1
try {
    Push-Location $repoRoot
    try {
        # -Force is accepted for compatibility. The cross-platform installer
        # replaces an existing shim automatically.
        & bun run scripts/install-minth.ts
        $exitCode = $LASTEXITCODE
    }
    finally {
        Pop-Location
    }
}
finally {
    if ($null -eq $previousBunBin) {
        Remove-Item Env:MINT_BUN_BIN -ErrorAction SilentlyContinue
    }
    else {
        $env:MINT_BUN_BIN = $previousBunBin
    }
}

exit $exitCode
