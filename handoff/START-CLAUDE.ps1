param(
    [ValidateSet('Fable', 'Opus')]
    [string]$Model = 'Fable'
)

$ErrorActionPreference = 'Stop'
$claudeExe = Join-Path $env:USERPROFILE '.local\bin\claude.exe'
if (-not (Test-Path -LiteralPath $claudeExe -PathType Leaf)) {
    $claudeExe = (Get-Command claude -ErrorAction Stop).Source
}

Write-Host 'Updating the installed Claude Code using its own updater...'
& $claudeExe update
if ($LASTEXITCODE -ne 0) {
    throw 'Claude update failed. No settings were changed by this launcher. Read the updater output.'
}

$versionOutput = (& $claudeExe --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $versionOutput -notmatch '(\d+\.\d+\.\d+)') {
    throw 'Cannot verify the Claude Code version.'
}
$installedVersion = [version]$Matches[1]
if ($installedVersion -lt [version]'2.1.280') {
    throw "Claude Code $installedVersion is too old for this profile. Required: 2.1.280 or later."
}

$modelId = if ($Model -eq 'Opus') { 'claude-opus-5-5' } else { 'claude-fable-5-1' }
$bootstrapPath = Join-Path $PSScriptRoot 'BOOTSTRAP.md'
$sessionSettings = Join-Path $PSScriptRoot $(if ($Model -eq 'Opus') { 'session-opus.json' } else { 'session-fable.json' })
if (-not (Test-Path -LiteralPath $bootstrapPath -PathType Leaf)) {
    throw 'BOOTSTRAP.md is missing next to this launcher.'
}
if (-not (Test-Path -LiteralPath $sessionSettings -PathType Leaf)) {
    throw 'The selected session settings file is missing next to this launcher.'
}
$initialPrompt = "Read the local file $bootstrapPath and carry out the setup requested by Alex. The explicitly selected bootstrap model is $modelId. Persist this selected model as the default; if it is Opus, do not switch the default back to Fable or test Fable with a paid request. Communicate in Russian. Preserve existing work and settings. Do not purchase credits or enable paid extras. If login or billing consent is required, let Alex complete it."

Push-Location -LiteralPath $PSScriptRoot
try {
    Write-Host "Starting $modelId with ultracode. Login or billing consent may require your input."
    & $claudeExe --settings $sessionSettings --model $modelId --effort ultracode $initialPrompt
    if ($LASTEXITCODE -ne 0) {
        Write-Warning 'Claude exited with an error. Do not switch to an unapproved model. For Opus, run this launcher with -Model Opus.'
    }
}
finally {
    Pop-Location
}
