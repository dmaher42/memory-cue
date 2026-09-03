[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$bridgeRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$sourcePath = Join-Path $bridgeRoot 'host\MemoryCueWindowsAttention.cs'
$outputDirectory = Join-Path $bridgeRoot 'artifacts'
$outputPath = Join-Path $outputDirectory 'MemoryCueWindowsAttention.exe'
$extensionDirectory = Join-Path $bridgeRoot 'extension'
$nativeManifestTemplate = Join-Path $bridgeRoot 'native-messaging\com.memorycue.windows_attention.json.template'

$compilerCandidates = @(
    'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe',
    'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe'
)
$compiler = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $compiler) {
    throw 'The Windows C# compiler was not found.'
}

$frameworkDirectory = Split-Path -Parent $compiler
$webExtensionsAssembly = Join-Path $frameworkDirectory 'System.Web.Extensions.dll'
if (-not (Test-Path -LiteralPath $webExtensionsAssembly)) {
    throw "Required framework assembly was not found: $webExtensionsAssembly"
}

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

$compilerArguments = @(
    '/nologo',
    '/target:exe',
    '/platform:anycpu',
    '/optimize+',
    ('/reference:' + $webExtensionsAssembly),
    ('/out:' + $outputPath),
    $sourcePath
)
& $compiler @compilerArguments
if ($LASTEXITCODE -ne 0) {
    throw "C# compilation failed with exit code $LASTEXITCODE."
}

& $outputPath '--self-test'
if ($LASTEXITCODE -ne 0) {
    throw "Native host self-test failed with exit code $LASTEXITCODE."
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    throw 'Node.js is required for extension syntax checks.'
}

foreach ($scriptName in @('content-script.js', 'background.js')) {
    & $node.Source '--check' (Join-Path $extensionDirectory $scriptName)
    if ($LASTEXITCODE -ne 0) {
        throw "JavaScript syntax check failed for $scriptName."
    }
}

foreach ($powerShellScript in @('build.ps1', 'install.ps1', 'uninstall.ps1')) {
    $tokens = $null
    $parseErrors = $null
    [System.Management.Automation.Language.Parser]::ParseFile(
        (Join-Path $PSScriptRoot $powerShellScript),
        [ref]$tokens,
        [ref]$parseErrors
    ) | Out-Null
    if ($parseErrors.Count -gt 0) {
        $messages = ($parseErrors | ForEach-Object { $_.Message }) -join '; '
        throw "PowerShell syntax check failed for ${powerShellScript}: $messages"
    }
}

Get-Content -LiteralPath (Join-Path $extensionDirectory 'manifest.json') -Raw | ConvertFrom-Json | Out-Null
$templateText = Get-Content -LiteralPath $nativeManifestTemplate -Raw
$templateText.Replace('__HOST_PATH__', 'C:\\placeholder\\host.exe').Replace('__EXTENSION_ID__', ('a' * 32)) | ConvertFrom-Json | Out-Null

Write-Host "Built and checked: $outputPath" -ForegroundColor Green
Write-Host 'No browser extension or Windows registration was installed.' -ForegroundColor Green
