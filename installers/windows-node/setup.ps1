# ServerForge Node setup for Windows (claude, 2026-10-30).
# Turns this PC into a ServerForge node: installs the app with its own bundled Node.js and SteamCMD,
# registers the Windows service (codex's service\Install-ServerForgeService.ps1), pairs with the
# panel using the one-time pairing file, and waits on a fingerprint screen until the admin approves.
# Run through Setup.cmd (it asks for administrator rights). Windows PowerShell 5.1 compatible; ASCII only.
[CmdletBinding()]
param(
    [string]$InstallDir = "$env:ProgramFiles\ServerForge",
    [string]$DataDir = "$env:ProgramData\ServerForge",
    [string]$PairingFile,
    [switch]$Uninstall,
    [switch]$Purge,
    [switch]$Repair          # pair again even though this PC already has a saved identity
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is very slow with the progress bar on 5.1
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$PanelService = 'ServerForge'          # names agreed with codex's service script
$LinkService = 'ServerForgeNode'

function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }
function Step($n, $total, $text) { Write-Host ''; Write-Host "[$n/$total] $text" -ForegroundColor Cyan }
function Fail($text) {
    Write-Host ''
    Write-Host "Setup stopped: $text" -ForegroundColor Red
    Write-Host "Nothing on the panel has changed. Fix the problem above and run Setup again." -ForegroundColor Yellow
    if ($script:Logging) { Stop-Transcript | Out-Null }
    exit 1
}

function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Data folder: only Administrators and SYSTEM (codex's service script adds the service account).
function New-PrivateDir($path) {
    if (-not (Test-Path $path)) { New-Item -ItemType Directory -Path $path -Force | Out-Null }
    & icacls $path /inheritance:r /grant:r '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-18:(OI)(CI)F' | Out-Null
}

function Stop-ServerForge {
    foreach ($name in @($LinkService, $PanelService)) {
        $svc = Get-Service -Name $name -ErrorAction SilentlyContinue
        if ($svc -and $svc.Status -ne 'Stopped') { Say "  Stopping $name..."; Stop-Service -Name $name -Force -ErrorAction SilentlyContinue }
    }
}

# Pick and check a pairing file; stops setup with a plain reason if it's wrong, expired or the panel is unreachable.
function Select-PairingFile($PairingFile) {
Say '  On the panel: Nodes > Add node > Download file. Copy that file to this PC.'
if (-not $PairingFile) {
    Add-Type -AssemblyName System.Windows.Forms
    $dlg = New-Object System.Windows.Forms.OpenFileDialog
    $dlg.Title = 'Choose the ServerForge pairing file (serverforge-enrolment.json)'
    $dlg.Filter = 'ServerForge pairing file (*.json)|*.json|All files (*.*)|*.*'
    $dlg.InitialDirectory = [Environment]::GetFolderPath('UserProfile') + '\Downloads'
    if ($dlg.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { Fail 'No pairing file chosen.' }
    $PairingFile = $dlg.FileName
}
try { $bundle = Get-Content -Raw -Path $PairingFile | ConvertFrom-Json } catch { Fail "That file isn't a ServerForge pairing file ($PairingFile)." }
foreach ($k in @('code', 'codeId', 'hubUrl', 'hubFingerprint', 'expiresAt')) { if (-not $bundle.$k) { Fail "That file isn't a ServerForge pairing file (missing $k)." } }
if ($bundle.hubUrl -notmatch '^wss://([^/:]+):(\d+)/') { Fail "The pairing file has an unexpected panel address: $($bundle.hubUrl)" }
$hubHost = $Matches[1]; $hubPort = [int]$Matches[2]
$minutesLeft = [math]::Floor(($bundle.expiresAt - [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) / 60000)
if ($minutesLeft -lt 1) { Fail 'This pairing file has expired (they last 10 minutes). On the panel make a new one: Nodes > Add node.' }
Say "  Panel: $hubHost  (file valid for about $minutesLeft more minutes)"

# The node dials out to the panel; nothing is opened on this PC. Check it can reach it.
$reach = Test-NetConnection -ComputerName $hubHost -Port $hubPort -WarningAction SilentlyContinue
if (-not $reach.TcpTestSucceeded) {
    $myIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1).IPAddress
    Fail "This PC can't reach the panel at ${hubHost}:$hubPort. Ask for this PC's IP ($myIp) to be allowed on the panel's firewall, then run Setup again."
}
Say "  Panel reachable from this PC." 'Green'
return $PairingFile
}

# Pair with --until-approved, show the fingerprint large, wait for Approve on the panel.
function Invoke-Pairing($PairingFile) {
$out = Join-Path $env:TEMP "sf-pair-$PID.log"
$env:NODE_DATA_DIR = Join-Path $DataDir 'node'
$env:DATA_DIR = Join-Path $DataDir 'data'
$env:NODE_LOCAL_API_URL = 'http://127.0.0.1:3230'
$pair = Start-Process -FilePath $nodeExe -ArgumentList @("`"$(Join-Path $InstallDir 'app\backend\node-client.js')`"", 'pair', "`"$PairingFile`"", '--until-approved') `
    -RedirectStandardOutput $out -RedirectStandardError "$out.err" -NoNewWindow -PassThru
$fingerprint = $null
for ($i = 0; $i -lt 60 -and -not $fingerprint -and -not $pair.HasExited; $i++) {
    Start-Sleep -Milliseconds 500
    $line = Get-Content $out -ErrorAction SilentlyContinue | Where-Object { $_ -match '^FINGERPRINT ' } | Select-Object -First 1
    if ($line) { $fingerprint = $line.Substring(12).Trim() }
}
if (-not $fingerprint) {
    $err = (Get-Content "$out.err", $out -ErrorAction SilentlyContinue) -join "`n"
    Fail "Pairing didn't start. $err"
}
Write-Host ''
Write-Host '  +---------------------------------------------------------------+' -ForegroundColor Yellow
Write-Host '  |  NOW APPROVE THIS PC ON THE PANEL                             |' -ForegroundColor Yellow
Write-Host '  |  Panel > Nodes > waiting card > check the fingerprint matches |' -ForegroundColor Yellow
Write-Host '  |  > tick the box > Approve                                     |' -ForegroundColor Yellow
Write-Host '  +---------------------------------------------------------------+' -ForegroundColor Yellow
Write-Host ''
Write-Host '  This PC''s fingerprint:' -ForegroundColor White
$groups = $fingerprint -split ' '
for ($i = 0; $i -lt $groups.Count; $i += 8) { Write-Host ('     ' + (($groups[$i..([math]::Min($i + 7, $groups.Count - 1))]) -join '  ')) -ForegroundColor Green }
Write-Host ''
Say '  Waiting for approval (the pairing file expires 10 minutes after it was made)...'
$pair.WaitForExit()
$pairLog = (Get-Content $out, "$out.err" -ErrorAction SilentlyContinue) -join "`n"
Remove-Item $out, "$out.err" -Force -ErrorAction SilentlyContinue
if ($pair.ExitCode -ne 0) { Fail "Not approved: $pairLog" }

# The pairing file is single-use and now spent; don't leave it lying around.
Remove-Item $PairingFile -Force -ErrorAction SilentlyContinue
}

# Restart the link and read its log until it connects or the panel refuses it (never approved / removed on the panel).
function Wait-Link {
    $logs = Join-Path $DataDir 'logs'
    $before = @{}; Get-ChildItem $logs -Filter 'ServerForgeNode*.log' -ErrorAction SilentlyContinue | ForEach-Object { $before[$_.FullName] = $_.Length }
    Restart-Service -Name $LinkService
    for ($i = 0; $i -lt 50; $i++) {
        Start-Sleep -Milliseconds 500
        $text = (Get-ChildItem $logs -Filter 'ServerForgeNode*.log' -ErrorAction SilentlyContinue | ForEach-Object {
            $fs = [IO.File]::Open($_.FullName, 'Open', 'Read', 'ReadWrite'); try { $start = [long]$before[$_.FullName]; if ($start -gt $fs.Length) { $start = 0 }; $null = $fs.Seek($start, 'Begin'); (New-Object IO.StreamReader($fs)).ReadToEnd() } finally { $fs.Dispose() } }) -join "`n"
        if ($text -match 'Node connected') { return 'connected' }
        if ($text -match 'AUTH_FAILED|revoked|unknown|refused|Pair this node first|identity is invalid') { return 'refused' }
    }
    return 'unknown'
}

# --- Uninstall -------------------------------------------------------------------------------
if ($Uninstall) {
    if (-not (Test-Admin)) { Fail 'Run Uninstall.cmd (it asks for administrator rights).' }
    Say 'ServerForge Node uninstall' 'White'
    $remover = Join-Path $InstallDir 'service\Uninstall-ServerForgeService.ps1'
    if (-not (Test-Path $remover)) { $remover = Join-Path $Here 'service\Uninstall-ServerForgeService.ps1' }
    Stop-ServerForge
    if (Test-Path $remover) { & $remover -AppDir (Join-Path $InstallDir 'app') -DataDir $DataDir }
    if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force; Say "  Removed $InstallDir" }
    if ($Purge) {
        $answer = Read-Host "  Also delete ALL game servers, backups and settings in $DataDir? Type DELETE to confirm"
        if ($answer -ceq 'DELETE') { Remove-Item $DataDir -Recurse -Force; Say "  Removed $DataDir" } else { Say '  Kept the data folder.' }
    } else {
        Say "  Kept your game servers and settings in $DataDir (run with -Purge to delete them)."
    }
    Say 'Done. Also remove this PC on the panel: Nodes > Remove.' 'Green'
    exit 0
}

# --- Install ---------------------------------------------------------------------------------
Clear-Host
Say '=====================================================' 'DarkCyan'
Say '  ServerForge Node setup' 'White'
Say '  Joins this PC to your ServerForge panel so you can'
Say '  run Windows game servers from the panel.'
Say '=====================================================' 'DarkCyan'

if (-not (Test-Admin)) { Fail 'This needs administrator rights. Double-click Setup.cmd instead of setup.ps1.' }
$Total = 6
$Identity = Join-Path $DataDir 'node\node-identity.json'
# Paired = the saved identity was approved (it has a nodeId). An attempt that was never approved leaves an identity
# without one (Daniel 3511: Setup said "already paired" but the panel had no such PC); that is discarded below.
function Test-Approved { try { return [bool]((Get-Content -Raw $Identity | ConvertFrom-Json).nodeId) } catch { return $false } }
$AlreadyPaired = (Test-Path $Identity) -and (Test-Approved) -and -not $Repair

# 1. Checks
Step 1 $Total 'Checking this PC'
$os = [Environment]::OSVersion.Version
if ($os.Major -lt 10) { Fail "Windows 10, 11 or Server 2019+ is needed (this is $os)." }
if (-not [Environment]::Is64BitOperatingSystem) { Fail '64-bit Windows is needed.' }
$node = Join-Path $Here 'runtime\node.exe'
$app = Join-Path $Here 'app\backend\server.js'
$serviceScript = Join-Path $Here 'service\Install-ServerForgeService.ps1'
foreach ($f in @($node, $app, $serviceScript)) { if (-not (Test-Path $f)) { Fail "Missing $f. Unzip the whole ServerForge-Node-Setup.zip first, then run Setup.cmd from inside it." } }
# ProgramData is a hidden folder, so take the drive letter from the path instead of Get-Item.
$driveName = (Split-Path -Qualifier $DataDir).TrimEnd(':')
$freeGb = [math]::Floor((Get-PSDrive -Name $driveName).Free / 1GB)
Say "  Windows $os, 64-bit, $freeGb GB free on ${driveName}:"
if ($freeGb -lt 30) { Say "  Warning: game servers need a lot of space (often 10-50 GB each). Only $freeGb GB is free." 'Yellow' }

New-PrivateDir $DataDir
$script:Logging = $true
Start-Transcript -Path (Join-Path $DataDir 'setup.log') -Append | Out-Null

# 2. Pairing file (asked early so a wrong or expired file stops setup before anything is installed)
Step 2 $Total 'Pairing file'
if ($AlreadyPaired) {
    Say '  This PC is already paired; keeping it. If the panel does not recognise it any more, Setup offers to pair again at the end.' 'Green'
} else {
if (Test-Path $Identity) { Remove-Item $Identity -Force; Say '  Removed an unfinished pairing from an earlier attempt.' }
$PairingFile = Select-PairingFile $PairingFile
}

# 3. Files
Step 3 $Total "Installing ServerForge to $InstallDir"
Stop-ServerForge
foreach ($part in @('app', 'runtime', 'service')) {
    $dest = Join-Path $InstallDir $part
    # service\ also holds the generated ServerForge*.exe/.xml for the installed services: never mirror-delete those.
    $mode = if ($part -eq 'service') { '/E' } else { '/MIR' }
    & robocopy (Join-Path $Here $part) $dest $mode /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { Fail "Copying $part failed (robocopy code $LASTEXITCODE)." }
}
Copy-Item (Join-Path $Here 'setup.ps1'), (Join-Path $Here 'Uninstall.cmd') $InstallDir -Force
foreach ($d in @('data', 'servers', 'backups', 'cache', 'steamcmd', 'node')) { $p = Join-Path $DataDir $d; if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p | Out-Null } }
$nodeExe = Join-Path $InstallDir 'runtime\node.exe'
Say "  $(& $nodeExe --version) (bundled, nothing else to install)"

# 4. SteamCMD (Valve's official download; it updates itself on first run)
Step 4 $Total 'SteamCMD'
$steamDir = Join-Path $DataDir 'steamcmd'
$steamExe = Join-Path $steamDir 'steamcmd.exe'
if (Test-Path $steamExe) { Say '  Already installed.' } else {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $zip = Join-Path $env:TEMP 'steamcmd.zip'
    Invoke-WebRequest -Uri 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip' -OutFile $zip -UseBasicParsing
    Expand-Archive -Path $zip -DestinationPath $steamDir -Force
    Remove-Item $zip -Force
    $sig = Get-AuthenticodeSignature -FilePath $steamExe
    if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'Valve') { Remove-Item $steamExe -Force; Fail "steamcmd.exe isn't signed by Valve (signature: $($sig.Status)). Not installing it." }
    Say '  Installed (signed by Valve).' 'Green'
}

# 5. Windows service (codex): local panel + node link, starts with Windows.
Step 5 $Total 'Windows service'
try { & (Join-Path $InstallDir 'service\Install-ServerForgeService.ps1') -AppDir (Join-Path $InstallDir 'app') -DataDir $DataDir -NodeExe $nodeExe }
catch { Fail "Service setup failed: $($_.Exception.Message)" }
Say '  Services installed; the local panel is running (this PC only, 127.0.0.1).' 'Green'
Say '  Firewall: game ports 2000-30000 allowed from your local network only.'

# 6. Pair, then wait for the admin to approve on the panel
Step 6 $Total 'Pairing with the panel'
if (-not $AlreadyPaired) { Invoke-Pairing $PairingFile }
$link = Wait-Link
if ($link -ne 'connected' -and $AlreadyPaired) {
    # Paired before, but the panel doesn't accept it any more (removed on the Nodes page, or panel reset).
    Say '  The panel no longer recognises this PC (it may have been removed on the Nodes page).' 'Yellow'
    $answer = Read-Host '  Pair it again now? You need a new pairing file from Nodes > Add node. [Y/n]'
    if ($answer -match '^(n|no)$') { Fail 'Not paired. Run Setup again when you have a pairing file.' }
    Stop-Service -Name $LinkService -Force -ErrorAction SilentlyContinue
    Remove-Item $Identity -Force -ErrorAction SilentlyContinue
    Invoke-Pairing (Select-PairingFile $null)
    $link = Wait-Link
}
if ($link -ne 'connected') { Fail "This PC didn't connect to the panel. See $DataDir\logs\ServerForgeNode.*.log" }
Say '  Connected to the panel.' 'Green'

Write-Host ''
Say '=====================================================' 'DarkGreen'
Say '  Done. This PC is joined to your ServerForge panel.' 'Green'
Say '  It starts by itself with Windows. Install Windows'
Say '  games from the panel: Install > Install on <this PC>.'
Say "  Uninstall: $InstallDir\Uninstall.cmd"
Say '=====================================================' 'DarkGreen'
Stop-Transcript | Out-Null
