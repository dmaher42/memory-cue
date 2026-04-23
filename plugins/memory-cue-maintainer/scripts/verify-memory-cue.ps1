[CmdletBinding()]
param(
    [switch]$IncludeReminderRegression
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-Step {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Label,

        [Parameter(Mandatory = $true)]
        [string]$FilePath,

        [Parameter()]
        [string[]]$Arguments = @()
    )

    Write-Host ""
    Write-Host "==> $Label" -ForegroundColor Cyan
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE."
    }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\\..\\..")).Path
Push-Location $repoRoot

try {
    Invoke-Step -Label "Jest tests" -FilePath "npm.cmd" -Arguments @("test", "--", "--runInBand")
    Invoke-Step -Label "Production build" -FilePath "npm.cmd" -Arguments @("run", "build")
    Invoke-Step -Label "Build verification" -FilePath "node" -Arguments @("scripts/verify-build.mjs")

    if ($IncludeReminderRegression) {
        Invoke-Step -Label "Reminder regression" -FilePath "npm.cmd" -Arguments @("run", "check:reminders")
    }
}
finally {
    Pop-Location
}
