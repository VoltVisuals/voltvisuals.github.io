# Полная настройка Supabase после schema.sql + Auth
# Нужен один из: SUPABASE_DB_PASSWORD или SUPABASE_ACCESS_TOKEN в secrets.local.env
param(
  [string]$ProjectRef = 'njgdqgrugpvaptfzejdv'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$secretsFile = Join-Path $PSScriptRoot 'secrets.local.env'

Get-Content $secretsFile | ForEach-Object {
  if ($_ -match '^\s*([^#=]+)=(.*)$') {
    [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), 'Process')
  }
}

Write-Host '→ 1/4 SQL (hotfix RLS + rpc)...'
if ($env:SUPABASE_DB_PASSWORD) {
  node (Join-Path $root 'tools\apply-rpc.mjs')
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} elseif ($env:SUPABASE_ACCESS_TOKEN) {
  supabase db execute --project-ref $ProjectRef --file (Join-Path $PSScriptRoot 'rpc.sql')
} else {
  Write-Host '   Пропуск: добавьте SUPABASE_DB_PASSWORD в supabase/secrets.local.env'
  Write-Host '   Dashboard → Settings → Database → Database password'
  Write-Host '   Или вставьте supabase/rpc.sql в SQL Editor вручную'
}

Write-Host '→ 2/4 Edge Function vv-api...'
if ($env:SUPABASE_ACCESS_TOKEN) {
  $env:SUPABASE_ACCESS_TOKEN = $env:SUPABASE_ACCESS_TOKEN
  Set-Location $root
  supabase link --project-ref $ProjectRef
  supabase secrets set "VOLT_HMAC_SECRET=$($env:VOLT_HMAC_SECRET)"
  supabase secrets set "VOLT_MOD_KEY=$($env:VOLT_MOD_KEY)"
  supabase secrets set "VOLT_REG_SECRET=$($env:VOLT_REG_SECRET)"
  supabase functions deploy vv-api --no-verify-jwt
} else {
  Write-Host '   Пропуск: нужен SUPABASE_ACCESS_TOKEN (supabase.com/dashboard/account/tokens)'
}

Write-Host '→ 3/4 Админ Lynivich...'
node (Join-Path $root 'tools\bootstrap-admin.mjs')

Write-Host '→ 4/4 Storage bucket mod-releases...'
node (Join-Path $root 'tools\ensure-storage.mjs')

Write-Host ''
Write-Host 'Готово. Проверьте: https://voltvisuals.github.io/login.html'
Write-Host 'Админ: Lynivich / viva2288'
