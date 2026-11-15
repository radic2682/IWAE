<#
Clean-Windows scenarios for the IWAE setup window.
Runs ONLY inside a disposable VM (Windows Sandbox / CI runner). See README.md.
Windows PowerShell 5.1 compatible. Save as UTF-8 WITH BOM (Korean literals below).
#>
param(
    [Parameter(Mandatory = $true)][string]$NewSetup,
    [Parameter(Mandatory = $true)][string]$OldSetup,
    [string]$Results = '.\results.json',
    [int]$TimeoutSec = 300,
    [string]$ExpectedVersion = '',
    [switch]$AllowSkip
)

$ErrorActionPreference = 'Stop'

# ---------- safety guard ----------
if ($env:IWAE_VM_TESTS -ne '1') {
    Write-Host 'Refusing to run: set IWAE_VM_TESTS=1 inside the disposable VM only.'
    exit 2
}
if (($env:USERNAME -ne 'WDAGUtilityAccount') -and ($env:CI -ne 'true')) {
    Write-Host 'Refusing to run: not inside Windows Sandbox (WDAGUtilityAccount) or CI (CI=true).'
    exit 2
}
$DefaultDir = Join-Path $env:LOCALAPPDATA 'IWAE'
if (Test-Path -LiteralPath (Join-Path $DefaultDir 'app.exe')) {
    Write-Host "Refusing to run: $DefaultDir\app.exe already exists (looks like a real install)."
    exit 2
}
foreach ($k in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\IWAE', 'HKCU:\Software\iwae\IWAE')) {
    if (Test-Path $k) {
        Write-Host "Refusing to run: $k already exists (looks like a real install)."
        exit 2
    }
}
if (-not (Test-Path -LiteralPath $NewSetup)) { Write-Host "NewSetup not found: $NewSetup"; exit 2 }
if (-not (Test-Path -LiteralPath $OldSetup)) { Write-Host "OldSetup not found: $OldSetup"; exit 2 }
$NewSetup = (Resolve-Path -LiteralPath $NewSetup).Path
$OldSetup = (Resolve-Path -LiteralPath $OldSetup).Path

$UninstKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\IWAE'
$LeftoverKey = 'HKCU:\Software\iwae'
$CustomDir = 'C:\Users\Public\IWAE 테스트'
$AppData = Join-Path $env:APPDATA 'dev.iwae.desktop'
$Sentinel = Join-Path $AppData 'vm-sentinel.txt'
$ResultList = New-Object System.Collections.ArrayList

# ---------- helpers ----------
function Add-Result([string]$name, [string]$status, [string]$detail) {
    [void]$ResultList.Add([pscustomobject]@{ name = $name; status = $status; passed = ($status -eq 'pass'); detail = $detail })
    Write-Host "[$($status.ToUpper())] $name - $detail"
}

function Save-Results {
    $json = ConvertTo-Json -InputObject @($ResultList) -Depth 4
    $full = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Results)
    [IO.File]::WriteAllText($full, $json, (New-Object System.Text.UTF8Encoding($false)))
}

# Runs a file, waits up to $Sec, returns the exit code (-999 and the process is killed on timeout).
function Wait-Proc([string]$File, [string]$ArgString, [int]$Sec = $TimeoutSec) {
    $p = $null
    if ($ArgString) { $p = Start-Process -FilePath $File -ArgumentList $ArgString -PassThru }
    else { $p = Start-Process -FilePath $File -PassThru }
    $null = $p.Handle   # PS 5.1 loses ExitCode without a cached handle
    if (-not $p.WaitForExit($Sec * 1000)) {
        try { Stop-Process -Id $p.Id -Force } catch { }
        return -999
    }
    return $p.ExitCode
}

function Get-Uninst {
    if (-not (Test-Path $UninstKey)) { return $null }
    return Get-ItemProperty -Path $UninstKey
}

function Assert-That([bool]$cond, [string]$msg) {
    if (-not $cond) { throw $msg }
}

function Get-AppProcs([string]$dir) {
    $found = @()
    foreach ($p in @(Get-Process -Name 'app' -ErrorAction SilentlyContinue)) {
        $path = $null
        try { $path = $p.Path } catch { }
        $prefix = $dir.TrimEnd('\') + '\'
        if ($path -and $path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { $found += $p }
    }
    return $found
}

function Stop-App {
    foreach ($d in @($DefaultDir, $CustomDir)) {
        foreach ($p in @(Get-AppProcs $d)) {
            try { Stop-Process -Id $p.Id -Force } catch { }
        }
    }
}

# True once an app.exe under $dir runs whose PID is not in $excludePids.
function Wait-AppRunning([string]$dir, [int]$Sec, [int[]]$excludePids = @()) {
    $end = (Get-Date).AddSeconds($Sec)
    while ((Get-Date) -lt $end) {
        foreach ($p in @(Get-AppProcs $dir)) {
            if ($excludePids -notcontains $p.Id) { return $true }
        }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Test-Interactive { return [Environment]::UserInteractive }

# Back to a clean machine: stop apps, uninstall from every known dir, drop leftover keys.
function Ensure-Uninstalled {
    Stop-App
    $dirs = @($DefaultDir, $CustomDir)
    $u = Get-Uninst
    if ($u -and $u.InstallLocation) { $dirs += ([string]$u.InstallLocation).Trim('"') }
    foreach ($d in ($dirs | Select-Object -Unique)) {
        $un = Join-Path $d 'uninstall.exe'
        if (Test-Path -LiteralPath $un) {
            [void](Wait-Proc $un "/S _?=$d" 120)
        }
        if (Test-Path -LiteralPath $d) { Remove-Item -LiteralPath $d -Recurse -Force -ErrorAction SilentlyContinue }
    }
    if (Test-Path $UninstKey) { Remove-Item -Path $UninstKey -Recurse -Force -ErrorAction SilentlyContinue }
    if (Test-Path $LeftoverKey) { Remove-Item -Path $LeftoverKey -Recurse -Force -ErrorAction SilentlyContinue }
}

function Ensure-Installed {
    if (-not (Test-Path -LiteralPath (Join-Path $DefaultDir 'app.exe'))) {
        Ensure-Uninstalled
        $code = Wait-Proc $NewSetup '/S'
        Assert-That ($code -eq 0) "prep install exited $code"
    }
}

function Expected-NewVersion {
    if ($ExpectedVersion) { return $ExpectedVersion }
    $m = [regex]::Match((Split-Path -Leaf $NewSetup), 'IWAE_(\d+\.\d+\.\d+)_')
    if ($m.Success) { return $m.Groups[1].Value }
    return $null
}

function Assert-Installed([string]$dir) {
    Assert-That (Test-Path -LiteralPath (Join-Path $dir 'app.exe')) "app.exe missing in $dir"
    Assert-That (Test-Path -LiteralPath (Join-Path $dir 'uninstall-ui.exe')) "uninstall-ui.exe missing in $dir"
    $u = Get-Uninst
    Assert-That ($null -ne $u) 'uninstall key missing'
    $want = "uninstall-ui.exe`" --uninstall"
    Assert-That ([string]$u.UninstallString).EndsWith($want, [StringComparison]::OrdinalIgnoreCase) "UninstallString was: $($u.UninstallString)"
    Assert-That ([string]$u.UninstallString).StartsWith("`"$dir\", [StringComparison]::OrdinalIgnoreCase) "UninstallString not under ${dir}: $($u.UninstallString)"
}

function Assert-NoDesktopLnk {
    $d = [Environment]::GetFolderPath('Desktop')
    Assert-That (-not (Test-Path -LiteralPath (Join-Path $d 'IWAE.lnk'))) 'Desktop IWAE.lnk was created'
}

function Run-Scenario([string]$name, [scriptblock]$body) {
    try {
        $detail = & $body
        $detail = [string]$detail
        if ($detail.StartsWith('skipped:')) { Add-Result $name 'skip' $detail }
        else { Add-Result $name 'pass' $detail }
    } catch {
        Add-Result $name 'fail' ($_.Exception.Message)
    }
    try { Stop-App } catch { }
    Save-Results
}

# ---------- scenarios ----------
Run-Scenario '1 silent fresh install' {
    Ensure-Uninstalled
    $code = Wait-Proc $NewSetup '/S'
    Assert-That ($code -eq 0) "exit code $code"
    Assert-Installed $DefaultDir
    Assert-NoDesktopLnk
    $lang = (Get-Content -LiteralPath (Join-Path $DefaultDir 'installer-language') -Raw).Trim()
    Assert-That (($lang -eq '1042') -or ($lang -eq '1033')) "installer-language was '$lang'"
    "installed, installer-language=$lang"
}

Run-Scenario '2 silent install to custom dir' {
    Ensure-Uninstalled
    $code = Wait-Proc $NewSetup "/S /D=$CustomDir"
    Assert-That ($code -eq 0) "exit code $code"
    Assert-Installed $CustomDir
    Assert-NoDesktopLnk
    "installed to $CustomDir"
}

Run-Scenario '3 old 0.2.6 then update' {
    if (-not (Test-Interactive)) { return 'skipped: no interactive desktop session' }
    Ensure-Uninstalled
    $code = Wait-Proc $OldSetup '/S'
    Assert-That ($code -eq 0) "old installer exit code $code"
    Assert-That (Test-Path -LiteralPath (Join-Path $DefaultDir 'app.exe')) 'old app.exe missing'
    New-Item -ItemType Directory -Force -Path $AppData | Out-Null
    Set-Content -LiteralPath $Sentinel -Value 'iwae vm sentinel' -Encoding UTF8
    $before = (Get-FileHash -LiteralPath $Sentinel -Algorithm SHA256).Hash
    Start-Process -FilePath (Join-Path $DefaultDir 'app.exe') | Out-Null
    Start-Sleep -Seconds 5
    # The real app quits itself before the updater runs the installer.
    $oldPids = @(Get-AppProcs $DefaultDir | ForEach-Object { $_.Id })
    Assert-That ($oldPids.Count -gt 0) 'old app.exe did not start'
    Stop-App
    # Update mode runs by itself and closes when done.
    $code = Wait-Proc $NewSetup '/P /R /UPDATE /ARGS'
    Assert-That ($code -eq 0) "update setup exit code $code"
    Assert-That (Wait-AppRunning $DefaultDir 60 $oldPids) 'new app.exe (different PID) not running within 60 s after update'
    $u = Get-Uninst
    $want = Expected-NewVersion
    if ($want) { Assert-That ($u.DisplayVersion -eq $want) "DisplayVersion $($u.DisplayVersion), expected $want" }
    else { Assert-That ($u.DisplayVersion -ne '0.2.6') 'DisplayVersion still 0.2.6' }
    Assert-Installed $DefaultDir
    $after = (Get-FileHash -LiteralPath $Sentinel -Algorithm SHA256).Hash
    Assert-That ($before -eq $after) 'app data sentinel changed'
    "updated to $($u.DisplayVersion), app running, sentinel intact"
}

Run-Scenario '4 update new to itself' {
    if (-not (Test-Interactive)) { return 'skipped: no interactive desktop session' }
    Ensure-Uninstalled
    $code = Wait-Proc $NewSetup '/S'
    Assert-That ($code -eq 0) "prep install exit code $code"
    $code = Wait-Proc $NewSetup '/P /R /UPDATE /ARGS'
    Assert-That ($code -eq 0) "self-update exit code $code"
    Assert-That (Wait-AppRunning $DefaultDir 60) 'app.exe not running within 60 s after self-update'
    Assert-Installed $DefaultDir
    'self-update kept the chain working'
}

Run-Scenario '5 sync uninstall' {
    Ensure-Installed
    $un = Join-Path $DefaultDir 'uninstall-ui.exe'
    $code = Wait-Proc $un "/S _?=$DefaultDir" 120
    Assert-That ($code -eq 0) "uninstall exit code $code"
    # Pass-through mode only runs `uninstall.exe /S _?=<dir>`; with `_?=` both uninstallers stay on disk.
    Assert-That (-not (Test-Path -LiteralPath (Join-Path $DefaultDir 'app.exe'))) 'app.exe still present'
    Assert-That (-not (Test-Path $UninstKey)) 'HKCU Uninstall\IWAE key still present'
    Assert-That (Test-Path -LiteralPath (Join-Path $DefaultDir 'uninstall.exe')) 'uninstall.exe missing (expected to remain with _?=)'
    Assert-That (Test-Path -LiteralPath (Join-Path $DefaultDir 'uninstall-ui.exe')) 'uninstall-ui.exe missing (expected to remain)'
    'app.exe and uninstall key gone; uninstallers remain as expected'
}

Run-Scenario '6 reinstall after uninstall' {
    Ensure-Installed
    $code = Wait-Proc (Join-Path $DefaultDir 'uninstall-ui.exe') "/S _?=$DefaultDir" 120
    Assert-That ($code -eq 0) "uninstall exit code $code"
    $code = Wait-Proc $NewSetup '/S'
    Assert-That ($code -eq 0) "reinstall exit code $code"
    Assert-Installed $DefaultDir
    'reinstalled'
}

Run-Scenario '7 uninstall UI window' {
    if (-not (Test-Interactive)) { return 'skipped: no interactive desktop session' }
    Ensure-Installed
    Start-Process -FilePath (Join-Path $DefaultDir 'uninstall-ui.exe') -ArgumentList '--uninstall' | Out-Null
    $titles = @('IWAE 설치', 'IWAE Setup')
    $found = $null
    $end = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $end -and -not $found) {
        foreach ($p in @(Get-Process -Name 'iwae-uninstall-*' -ErrorAction SilentlyContinue)) {
            if ($titles -contains $p.MainWindowTitle) { $found = $p.MainWindowTitle; break }
        }
        if (-not $found) { Start-Sleep -Milliseconds 500 }
    }
    foreach ($p in @(Get-Process -Name 'iwae-uninstall-*', 'uninstall-ui' -ErrorAction SilentlyContinue)) {
        try { Stop-Process -Id $p.Id -Force } catch { }
    }
    Assert-That ($null -ne $found) 'no uninstall window titled "IWAE 설치" or "IWAE Setup" within 20 s'
    "window title: $found"
}

Run-Scenario '8 setup killed mid-install, then rerun' {
    Ensure-Uninstalled
    $p = Start-Process -FilePath $NewSetup -ArgumentList '/S' -PassThru
    $null = $p.Handle
    Start-Sleep -Seconds 2
    # Make sure the inner NSIS exists before killing the outer process, or the test proves nothing.
    $appeared = $false
    $until = (Get-Date).AddSeconds(10)
    while ((Get-Date) -lt $until -and -not $appeared) {
        if (@(Get-Process -Name 'IWAE-inner-setup' -ErrorAction SilentlyContinue).Count -gt 0) { $appeared = $true }
        else { Start-Sleep -Milliseconds 200 }
    }
    try { Stop-Process -Id $p.Id -Force } catch { }
    if (-not $appeared) { throw 'inconclusive: IWAE-inner-setup never appeared within 10 s' }
    # The NSIS child keeps running by design; let it finish.
    $end = (Get-Date).AddSeconds(120)
    while ((Get-Date) -lt $end -and @(Get-Process -Name 'IWAE-inner-setup' -ErrorAction SilentlyContinue).Count -gt 0) {
        Start-Sleep -Seconds 1
    }
    Assert-That (@(Get-Process -Name 'IWAE-inner-setup' -ErrorAction SilentlyContinue).Count -eq 0) 'inner setup still running after 120 s'
    $code = Wait-Proc $NewSetup '/S'
    Assert-That ($code -eq 0) "second run exit code $code"
    Assert-That (Test-Path -LiteralPath (Join-Path $DefaultDir 'app.exe')) 'app.exe missing after second run'
    'second run succeeded'
}

Run-Scenario '9 Defender scan of setup exe' {
    try {
        Start-MpScan -ScanType CustomScan -ScanPath $NewSetup
    } catch {
        return "skipped: $($_.Exception.Message)"
    }
    $hits = @()
    try {
        $leaf = [IO.Path]::GetFileName($NewSetup)
        $hits = @(Get-MpThreatDetection -ErrorAction Stop | Where-Object {
            $_.Resources -and (($_.Resources -join ' ') -like "*$leaf*")
        })
    } catch {
        return "skipped: scan ran, detections not readable: $($_.Exception.Message)"
    }
    Assert-That ($hits.Count -eq 0) "Defender detected a threat in $NewSetup"
    'no threat detected'
}

Ensure-Uninstalled
Save-Results
$nPass = @($ResultList | Where-Object { $_.status -eq 'pass' }).Count
$failed = @($ResultList | Where-Object { $_.status -eq 'fail' }).Count
$skipped = @($ResultList | Where-Object { $_.status -eq 'skip' }).Count
Write-Host "Done: $nPass passed, $failed failed, $skipped skipped. Results: $Results"
if ($failed -gt 0) { exit 1 }
if (($skipped -gt 0) -and (-not $AllowSkip)) { exit 1 }
exit 0
