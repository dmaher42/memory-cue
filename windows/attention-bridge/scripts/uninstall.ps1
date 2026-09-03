[CmdletBinding()]
param(
    [switch]$KeepFiles
)

$ErrorActionPreference = 'Stop'

$localAppData = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::LocalApplicationData)
if ([string]::IsNullOrWhiteSpace($localAppData)) {
    throw 'Windows did not return the current user Local AppData folder.'
}

$localAppDataRoot = [System.IO.Path]::GetFullPath($localAppData).TrimEnd('\', '/')
$memoryCueProgramsRoot = [System.IO.Path]::GetFullPath((Join-Path $localAppDataRoot 'Programs\MemoryCue'))
$memoryCueLegacyRoot = [System.IO.Path]::GetFullPath((Join-Path $localAppDataRoot 'MemoryCue'))
$installDirectory = [System.IO.Path]::GetFullPath((Join-Path $memoryCueProgramsRoot 'WindowsAttentionBridge'))
$legacyInstallDirectory = [System.IO.Path]::GetFullPath((Join-Path $memoryCueLegacyRoot 'WindowsAttentionBridge'))
$installedManifest = Join-Path $installDirectory 'com.memorycue.windows_attention.json'
$legacyManifest = Join-Path $legacyInstallDirectory 'com.memorycue.windows_attention.json'
$ownedManifests = @($installedManifest, $legacyManifest)
$registryPaths = @(
    'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.memorycue.windows_attention',
    'HKCU:\Software\Chromium\NativeMessagingHosts\com.memorycue.windows_attention',
    'HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.memorycue.windows_attention'
)

foreach ($registryPath in $registryPaths) {
    if (Test-Path -LiteralPath $registryPath) {
        $currentRegistration = (Get-Item -LiteralPath $registryPath).GetValue('')
        $isOwnedRegistration = $ownedManifests | Where-Object {
            [string]::Equals($currentRegistration, $_, [System.StringComparison]::OrdinalIgnoreCase)
        }
        if ($isOwnedRegistration) {
            Remove-Item -LiteralPath $registryPath -Recurse -Force
            Write-Host "Removed the Memory Cue native-messaging registration: $registryPath"
        }
        else {
            Write-Warning "The registration points somewhere else and was left unchanged: $currentRegistration"
        }
    }
}

if (-not $KeepFiles) {
    $ownedDirectories = @(
        $installDirectory,
        $legacyInstallDirectory
    )

    $ownedFileNames = @(
        'MemoryCueWindowsAttention.exe',
        'com.memorycue.windows_attention.json'
    )

    foreach ($ownedDirectory in $ownedDirectories) {
        $normalizedDirectory = [System.IO.Path]::GetFullPath($ownedDirectory).TrimEnd('\', '/')
        $localAppDataPrefix = $localAppDataRoot + [System.IO.Path]::DirectorySeparatorChar
        if (-not $normalizedDirectory.StartsWith($localAppDataPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to touch a directory outside Local AppData: $normalizedDirectory"
        }

        $relativeDirectory = $normalizedDirectory.Substring($localAppDataPrefix.Length)
        $currentDirectory = $localAppDataRoot
        foreach ($pathPart in $relativeDirectory.Split([System.IO.Path]::DirectorySeparatorChar, [System.StringSplitOptions]::RemoveEmptyEntries)) {
            $currentDirectory = Join-Path $currentDirectory $pathPart
            if (Test-Path -LiteralPath $currentDirectory) {
                $currentItem = Get-Item -LiteralPath $currentDirectory -Force
                if (($currentItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                    throw "Refusing to remove bridge files through a junction or symbolic link: $currentDirectory"
                }
            }
        }

        if (-not (Test-Path -LiteralPath $normalizedDirectory -PathType Container)) {
            continue
        }

        foreach ($ownedFileName in $ownedFileNames) {
            $ownedFile = Join-Path $normalizedDirectory $ownedFileName
            if (-not (Test-Path -LiteralPath $ownedFile)) {
                continue
            }

            $ownedFileItem = Get-Item -LiteralPath $ownedFile -Force
            if (($ownedFileItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Refusing to remove a bridge file that is a symbolic link: $ownedFile"
            }
            if (-not $ownedFileItem.PSIsContainer) {
                Remove-Item -LiteralPath $ownedFile -Force
                Write-Host "Removed installed bridge file: $ownedFile"
            }
            else {
                Write-Warning "Expected a bridge file but found a directory, so it was left unchanged: $ownedFile"
            }
        }

        $remainingItems = @(Get-ChildItem -LiteralPath $normalizedDirectory -Force)
        if ($remainingItems.Count -eq 0) {
            Remove-Item -LiteralPath $normalizedDirectory -Force
            Write-Host "Removed empty bridge folder: $normalizedDirectory"
        }
        else {
            $remainingNames = ($remainingItems | ForEach-Object { $_.Name }) -join ', '
            Write-Warning "The bridge folder contains other files and was kept: $normalizedDirectory ($remainingNames)"
        }
    }
}

Write-Host 'The existing Memory Cue startup and always-on-top launcher were not changed.'
Write-Host 'Remove the unpacked extension separately in brave://extensions if it is still loaded.'
