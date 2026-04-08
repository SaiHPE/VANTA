param(
  [switch]$Rebuild,
  [switch]$Wait
)

$ErrorActionPreference = "Stop"

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir

$bun = @(
  (Get-Command bun -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
  $(if ($env:BUN_INSTALL) { Join-Path $env:BUN_INSTALL "bin\bun.exe" }),
  $(if ($env:USERPROFILE) { Join-Path $env:USERPROFILE ".bun\bin\bun.exe" })
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if (-not $bun) {
  Write-Host "Bun was not found." -ForegroundColor Red
  Write-Host "Install Bun first, then run this launcher again." -ForegroundColor Yellow
  Write-Host "https://bun.com/docs/installation"
  exit 1
}

$mod = Join-Path $dir "node_modules"
if ($Rebuild -or -not (Test-Path $mod)) {
  Write-Host "Installing dependencies..." -ForegroundColor Cyan
  & $bun --use-system-ca install
  if ($LASTEXITCODE -ne 0) {
    Write-Host "bun install failed." -ForegroundColor Red
    exit $LASTEXITCODE
  }
}

function Listen($port) {
  return @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue).Count -gt 0
}

$api = 4096
$web = 4444
$back = @("--use-system-ca", "run", "--cwd", "packages/opencode", "--conditions=browser", "./src/index.ts", "serve", "--port", "$api")
$front = @("--cwd", "packages/app", "dev", "--", "--port", "$web")
$jobs = @()

if (Listen $api) {
  Write-Host "Backend already listening on http://localhost:$api" -ForegroundColor Yellow
} else {
  Write-Host "Starting backend on http://localhost:$api..." -ForegroundColor Green
  $jobs += Start-Process -FilePath $bun -ArgumentList $back -WorkingDirectory $dir -PassThru
}

if (Listen $web) {
  Write-Host "App already listening on http://localhost:$web" -ForegroundColor Yellow
} else {
  Write-Host "Starting app dev server on http://localhost:$web..." -ForegroundColor Green
  $jobs += Start-Process -FilePath $bun -ArgumentList $front -WorkingDirectory $dir -PassThru
}

Write-Host "Opening http://localhost:$web" -ForegroundColor Cyan
Start-Sleep -Seconds 2
Start-Process "http://localhost:$web"

if ($Wait -and $jobs.Count -gt 0) {
  Wait-Process -Id $jobs.Id
}
