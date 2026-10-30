# Removes the ServerForge Windows services and firewall rule (claude, 2026-10-30). Keeps all data.
[CmdletBinding()]
param([string]$AppDir, [string]$DataDir)
$ErrorActionPreference = 'Continue'
$SvcDir = Split-Path -Parent $MyInvocation.MyCommand.Path
foreach ($id in @('ServerForgeNode', 'ServerForge')) {
    if (Get-Service -Name $id -ErrorAction SilentlyContinue) {
        Stop-Service -Name $id -Force -ErrorAction SilentlyContinue
        $exe = Join-Path $SvcDir "$id.exe"
        if (Test-Path $exe) { & $exe uninstall | Out-Null } else { & sc.exe delete $id | Out-Null }
        Write-Host "  Removed service $id"
    }
}
Get-NetFirewallRule -DisplayName 'ServerForge game servers (LAN)' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
