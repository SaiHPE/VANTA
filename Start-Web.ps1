param(
  [switch]$Rebuild,
  [switch]$Wait
)

$ErrorActionPreference = "Stop"

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $dir

$bun = @(
  (Get-Command bun -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
  $(if ($env:BUN_INSTALL) { Join-Path $env:BUN_INSTALL "bin\\bun.exe" }),
  $(if ($env:USERPROFILE) { Join-Path $env:USERPROFILE ".bun\\bin\\bun.exe" })
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

if (-not $bun) {
  Write-Host "Bun was not found." -ForegroundColor Red
  Write-Host "Install Bun first, then run this launcher again." -ForegroundColor Yellow
  Write-Host "https://bun.com/docs/installation"
  exit 1
}

$mod = Join-Path $dir "node_modules"
if (-not (Test-Path $mod)) {
  Write-Host "Installing dependencies..." -ForegroundColor Cyan
  & $bun --use-system-ca install
  if ($LASTEXITCODE -ne 0) {
    Write-Host "bun install failed." -ForegroundColor Red
    exit $LASTEXITCODE
  }
}

$dist = Join-Path $dir "packages\\app\\dist\\index.html"
if ($Rebuild -or -not (Test-Path $dist)) {
  Write-Host "Building web app..." -ForegroundColor Cyan
  & $bun --use-system-ca run --cwd packages/app build
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Web build failed." -ForegroundColor Red
    exit $LASTEXITCODE
  }
}

$arg = @("--use-system-ca", "run", "--cwd", "packages/opencode", "src/index.ts", "web")

Write-Host "Starting OpenCode Web..." -ForegroundColor Green

if ($Wait) {
  & $bun @arg
  exit $LASTEXITCODE
}

Start-Process -FilePath $bun -ArgumentList $arg -WorkingDirectory $dir
