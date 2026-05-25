# VoltVisuals — автонастройка Supabase
# Запуск: .\supabase\setup.ps1 -ProjectRef abcdefghijklmnop
param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRef
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$secretsFile = Join-Path $PSScriptRoot 'secrets.local.env'

if (-not (Test-Path $secretsFile)) {
  Write-Error "Нет файла supabase/secrets.local.env"
}

Get-Content $secretsFile | ForEach-Object {
  if ($_ -match '^\s*([^#=]+)=(.*)$') {
    [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), 'Process')
  }
}

$pub = $env:SUPABASE_PUBLISHABLE_KEY
$secret = $env:SUPABASE_SECRET_KEY
$url = "https://$ProjectRef.supabase.co"
$apiUrl = "$url/functions/v1/vv-api"

Write-Host "→ Project URL: $url"

# js/supabase-config.js
$configPath = Join-Path $root 'js\supabase-config.js'
@"
window.VV_SUPABASE_URL = '$url';
window.VV_SUPABASE_ANON_KEY = '$pub';
window.VV_API_URL = '$apiUrl';
"@ | Set-Content $configPath -Encoding UTF8
Write-Host "→ Обновлён js/supabase-config.js"

# Mod default URL hint
Write-Host ""
Write-Host "→ В моде замените YOUR_PROJECT_REF на: $ProjectRef"
Write-Host "  apiUrl = $apiUrl"
Write-Host ""

if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
  Write-Host "Supabase CLI не найден. Установите: npm install -g supabase"
  exit 0
}

Write-Host "→ supabase login (откроется браузер)..."
supabase login

Set-Location $root
supabase link --project-ref $ProjectRef

Write-Host "→ SQL schema..."
supabase db execute --file supabase/schema.sql

Write-Host "→ Secrets для Edge Function..."
supabase secrets set "VOLT_HMAC_SECRET=$($env:VOLT_HMAC_SECRET)"
supabase secrets set "VOLT_MOD_KEY=$($env:VOLT_MOD_KEY)"
supabase secrets set "VOLT_REG_SECRET=$($env:VOLT_REG_SECRET)"

Write-Host "→ Deploy vv-api..."
supabase functions deploy vv-api --no-verify-jwt

Write-Host ""
Write-Host "Готово! Осталось:"
Write-Host "1. Dashboard → Authentication → Email → Confirm email: OFF"
Write-Host "2. Site URL: https://voltvisuals.github.io"
Write-Host "3. Storage → bucket mod-releases (private) → загрузить voltvisuals-1.6.1.jar"
Write-Host "4. Зарегистрироваться на сайте, затем SQL:"
Write-Host "   UPDATE public.profiles SET role = 'admin' WHERE email = 'ваш@email.com';"
Write-Host "5. git push — обновить GitHub Pages"
