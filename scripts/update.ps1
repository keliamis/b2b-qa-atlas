$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if (-not (Test-Path '.env')) { throw 'Copy your existing working .env into this folder first.' }
docker compose --profile build-worker build worker-image
if ($LASTEXITCODE -ne 0) { throw 'Worker image build failed.' }
docker compose up -d --build --wait backend ml-service runner
if ($LASTEXITCODE -ne 0) { throw 'Service startup failed. Run docker compose logs --tail=100.' }
docker compose exec backend node scripts/check_runner.mjs
if ($LASTEXITCODE -ne 0) { throw 'Runner check failed. See docker compose logs --tail=100 runner.' }
Write-Host 'Ready: http://localhost:8080'
