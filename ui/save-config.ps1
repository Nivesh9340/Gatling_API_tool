param(
  [Parameter(Mandatory = $true)]
  [string]$InputYamlPath
)

$projectRoot = Split-Path -Parent $PSScriptRoot
$target = Join-Path $projectRoot "src\test\resources\my-api-config.yaml"

if (!(Test-Path $InputYamlPath)) {
  Write-Error "Input YAML not found: $InputYamlPath"
  exit 1
}

Copy-Item -Path $InputYamlPath -Destination $target -Force
Write-Host "Saved config to $target"
