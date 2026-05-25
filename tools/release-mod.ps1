# Build mod + upload to Supabase Storage
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$modRoot = Join-Path (Split-Path $root -Parent) 'VoltVisuals'
$env:JAVA_HOME = 'C:\Program Files\Eclipse Adoptium\jdk-17.0.18.8-hotspot'

Write-Host 'Gradle build...'
Set-Location $modRoot
.\gradlew.bat build --no-daemon

$jar = Join-Path $modRoot 'build\libs\voltvisuals-1.6.1.jar'
if (-not (Test-Path $jar)) { throw "JAR not found" }

Write-Host 'Copy to server/files...'
Copy-Item $jar (Join-Path $root 'server\files\voltvisuals-1.6.1.jar') -Force

Write-Host 'Upload to Supabase Storage...'
Set-Location $root
node tools\upload-mod.mjs $jar

Write-Host 'Done'
