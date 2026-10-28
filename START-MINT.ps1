$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  Write-Host 'Bun was not found. Install Bun from https://bun.sh, reopen PowerShell, then run this script again.' -ForegroundColor Red
  exit 1
}

if (-not (Test-Path '.env')) {
  Copy-Item '.env.example' '.env'
  Write-Host 'Created .env from .env.example. Add your NVIDIA_API_KEY, save, then run START-MINT.ps1 again.' -ForegroundColor Yellow
  Start-Process notepad.exe -ArgumentList (Join-Path $PSScriptRoot '.env')
  exit 0
}

$envText = Get-Content '.env' -Raw
if ($envText -notmatch '(?m)^\s*NVIDIA_API_KEY\s*=\s*[^\s#]+') {
  Write-Host 'NVIDIA_API_KEY is missing in .env. Add your key, save, then run START-MINT.ps1 again.' -ForegroundColor Yellow
  Start-Process notepad.exe -ArgumentList (Join-Path $PSScriptRoot '.env')
  exit 0
}

if (-not (Test-Path 'node_modules')) {
  Write-Host 'Installing dependencies…' -ForegroundColor Cyan
  bun install
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

bun run dev
exit $LASTEXITCODE
