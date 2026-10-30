# ServerForge Windows services (claude, 2026-10-30; written while codex was at its usage limit,
# for codex review). Called by setup.ps1. Registers two services with WinSW (bundled, pinned):
#   ServerForge      the node's own panel, listening on 127.0.0.1:3230 only (never on the LAN)
#   ServerForgeNode  the outbound link to the hub; started by setup.ps1 once the PC is paired
# Both run as NT AUTHORITY\LocalService (not SYSTEM), so a compromised game server can't take the PC.
# Windows PowerShell 5.1 compatible; ASCII only.
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string]$AppDir,
    [Parameter(Mandatory)] [string]$DataDir,
    [Parameter(Mandatory)] [string]$NodeExe,
    [int]$Port = 3230
)
$ErrorActionPreference = 'Stop'
$SvcDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$WinSW = Join-Path $SvcDir 'WinSW.exe'
if (-not (Test-Path $WinSW)) { throw "Missing $WinSW" }
$LocalService = '*S-1-5-19'

function Esc($v) { return [Security.SecurityElement]::Escape([string]$v) }

function Register-SfService($id, $description, $arguments, [hashtable]$envVars, $depends) {
    $exe = Join-Path $SvcDir "$id.exe"
    $xml = Join-Path $SvcDir "$id.xml"
    if (Get-Service -Name $id -ErrorAction SilentlyContinue) {
        Stop-Service -Name $id -Force -ErrorAction SilentlyContinue
        & $exe uninstall | Out-Null
        Start-Sleep -Seconds 2
    }
    Copy-Item $WinSW $exe -Force
    $envXml = ($envVars.GetEnumerator() | Sort-Object Name | ForEach-Object { "  <env name=`"$($_.Name)`" value=`"$(Esc $_.Value)`" />" }) -join "`r`n"
    $dependXml = if ($depends) { "  <depend>$depends</depend>" } else { '' }
    @"
<service>
  <id>$id</id>
  <name>$id</name>
  <description>$(Esc $description)</description>
  <executable>$(Esc $NodeExe)</executable>
  <arguments>$(Esc $arguments)</arguments>
  <workingdirectory>$(Esc (Join-Path $AppDir 'backend'))</workingdirectory>
$envXml
$dependXml
  <startmode>Automatic</startmode>
  <delayedAutoStart>true</delayedAutoStart>
  <onfailure action="restart" delay="10 sec" />
  <onfailure action="restart" delay="30 sec" />
  <onfailure action="restart" delay="60 sec" />
  <resetfailure>1 hour</resetfailure>
  <stoptimeout>25 sec</stoptimeout>
  <logpath>$(Esc (Join-Path $DataDir 'logs'))</logpath>
  <log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>5</keepFiles></log>
</service>
"@ | Set-Content -Path $xml -Encoding ASCII
    & $exe install | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "WinSW could not install $id (code $LASTEXITCODE)" }
    # Run as LocalService (WMI takes the empty password for built-in accounts; sc.exe via PS 5.1 can't).
    $r = Get-CimInstance Win32_Service -Filter "Name='$id'" | Invoke-CimMethod -MethodName Change -Arguments @{ StartName = 'NT AUTHORITY\LocalService'; StartPassword = '' }
    if ($r.ReturnValue -ne 0) { throw "Could not set $id to run as LocalService (WMI code $($r.ReturnValue))" }
}

# LocalService may read the app and change only the data folder.
foreach ($d in @('logs', 'data', 'servers', 'backups', 'cache', 'steamcmd', 'node')) {
    $p = Join-Path $DataDir $d; if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p | Out-Null }
}
& icacls $DataDir /grant "${LocalService}:(OI)(CI)M" /T /C /Q | Out-Null
& icacls (Split-Path -Parent $AppDir) /grant "${LocalService}:(OI)(CI)RX" /T /C /Q | Out-Null

$common = @{
    NODE_ENV = 'production'
    DATA_DIR = (Join-Path $DataDir 'data')
}
$panelEnv = $common + @{
    HOST = '127.0.0.1'
    PORT = "$Port"
    SERVERS_ROOT = (Join-Path $DataDir 'servers')
    BACKUPS_DIR = (Join-Path $DataDir 'backups')
    CACHE_DIR = (Join-Path $DataDir 'cache')
    STEAMCMD_DIR = (Join-Path $DataDir 'steamcmd')
}
$linkEnv = $common + @{
    NODE_DATA_DIR = (Join-Path $DataDir 'node')
    NODE_LOCAL_API_URL = "http://127.0.0.1:$Port"
}
Register-SfService 'ServerForge' 'ServerForge node: local game-server panel (127.0.0.1 only)' "`"$(Join-Path $AppDir 'backend\server.js')`"" $panelEnv $null
Register-SfService 'ServerForgeNode' 'ServerForge node: outbound link to the ServerForge panel' "`"$(Join-Path $AppDir 'backend\node-client.js')`"" $linkEnv 'ServerForge'

# Game servers on this PC must be reachable from the LAN (never from the internet): one rule for
# the usual game port range, local subnet only. Services can't show the Windows Firewall prompt.
Get-NetFirewallRule -DisplayName 'ServerForge game servers (LAN)' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
foreach ($proto in @('TCP', 'UDP')) {
    New-NetFirewallRule -DisplayName 'ServerForge game servers (LAN)' -Direction Inbound -Action Allow -Protocol $proto `
        -LocalPort '2000-30000' -RemoteAddress LocalSubnet -Profile Any | Out-Null
}

Start-Service -Name 'ServerForge'
$ok = $false
for ($i = 0; $i -lt 40 -and -not $ok; $i++) {
    Start-Sleep -Milliseconds 750
    try { $ok = (Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/auth-mode" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch { $ok = $false }
}
if (-not $ok) { throw "The ServerForge service didn't start. See $(Join-Path $DataDir 'logs')" }
# ServerForgeNode is left for setup.ps1 to start after pairing (it needs the saved identity).
