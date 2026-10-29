$ErrorActionPreference = 'Stop'

Write-Host 'MINT: TypeScript type-check' -ForegroundColor Cyan
bun run typecheck
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host 'MINT: Test suite' -ForegroundColor Cyan
bun run test
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host 'MINT: checks passed' -ForegroundColor Green
