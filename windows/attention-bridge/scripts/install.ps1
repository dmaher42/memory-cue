[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-p]{32}$')]
    [string]$ExtensionId,

    [string]$HostExecutable,

    [switch]$Force
)

$ErrorActionPreference = 'Stop'

$bridgeRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ([string]::IsNullOrWhiteSpace($HostExecutable)) {
    $HostExecutable = Join-Path $bridgeRoot 'artifacts\MemoryCueWindowsAttention.exe'
}
$HostExecutable = [System.IO.Path]::GetFullPath($HostExecutable)
if (-not (Test-Path -LiteralPath $HostExecutable -PathType Leaf)) {
    throw "Built host not found at $HostExecutable. Run build.ps1 first."
}

$localAppData = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::LocalApplicationData)
if ([string]::IsNullOrWhiteSpace($localAppData)) {
    throw 'Windows did not return the current user Local AppData folder.'
}
$localAppDataRoot = [System.IO.Path]::GetFullPath($localAppData)
$installDirectory = [System.IO.Path]::GetFullPath((Join-Path $localAppDataRoot 'Programs\MemoryCue\WindowsAttentionBridge'))
$legacyInstallDirectory = [System.IO.Path]::GetFullPath((Join-Path $localAppDataRoot 'MemoryCue\WindowsAttentionBridge'))
$installedHost = Join-Path $installDirectory 'MemoryCueWindowsAttention.exe'
$installedManifest = Join-Path $installDirectory 'com.memorycue.windows_attention.json'
$legacyManifest = Join-Path $legacyInstallDirectory 'com.memorycue.windows_attention.json'
$templatePath = Join-Path $bridgeRoot 'native-messaging\com.memorycue.windows_attention.json.template'
$registryPaths = @(
    'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.memorycue.windows_attention',
    'HKCU:\Software\Chromium\NativeMessagingHosts\com.memorycue.windows_attention',
    'HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.memorycue.windows_attention'
)

foreach ($registryPath in $registryPaths) {
    if (Test-Path -LiteralPath $registryPath) {
        $currentRegistration = (Get-Item -LiteralPath $registryPath).GetValue('')
        $isOwnedRegistration =
            [string]::Equals($currentRegistration, $installedManifest, [System.StringComparison]::OrdinalIgnoreCase) -or
            [string]::Equals($currentRegistration, $legacyManifest, [System.StringComparison]::OrdinalIgnoreCase)
        if ($currentRegistration -and -not $isOwnedRegistration -and -not $Force) {
            throw "A different native host is already registered at $currentRegistration. Re-run with -Force only after checking it."
        }
    }
}

New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
Copy-Item -LiteralPath $HostExecutable -Destination $installedHost -Force

$hostJsonString = ConvertTo-Json $installedHost -Compress
$hostJsonContent = $hostJsonString.Substring(1, $hostJsonString.Length - 2)
$manifestContent = Get-Content -LiteralPath $templatePath -Raw
$manifestContent = $manifestContent.Replace('__HOST_PATH__', $hostJsonContent)
$manifestContent = $manifestContent.Replace('__EXTENSION_ID__', $ExtensionId)
$manifestContent | ConvertFrom-Json | Out-Null
[System.IO.File]::WriteAllText($installedManifest, $manifestContent, (New-Object System.Text.UTF8Encoding($false)))

foreach ($registryPath in $registryPaths) {
    New-Item -Path $registryPath -Force | Out-Null
    Set-Item -LiteralPath $registryPath -Value $installedManifest
}

Write-Host 'Memory Cue Windows attention bridge registered for the current user.' -ForegroundColor Green
Write-Host "Native host: $installedHost"
Write-Host "Allowed Brave extension: $ExtensionId"
if (Test-Path -LiteralPath $legacyInstallDirectory) {
    Write-Host "The previous bridge folder was left in place for safe migration: $legacyInstallDirectory"
}
Write-Host 'The existing Memory Cue startup and always-on-top launcher were not changed.'
