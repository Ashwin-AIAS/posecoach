<#
.SYNOPSIS
    Safe disk cleanup script for Windows dev machines.
.DESCRIPTION
    Clears user/system temp folders, Recycle Bin, npm/pip caches, and
    optionally the Windows component store. Reports freed space at the end.
.NOTES
    Some operations (Windows Temp, component store) need an elevated
    (Administrator) PowerShell. The script auto-detects and skips those
    if not elevated, so it's safe to run either way.
.EXAMPLE
    .\Clear-Space.ps1
    .\Clear-Space.ps1 -DeepClean      # also runs DISM component cleanup
#>

param(
    [switch]$DeepClean
)

# --- helpers ---------------------------------------------------------------
function Get-FreeGB {
    $drive = Get-PSDrive -Name C
    return [math]::Round($drive.Free / 1GB, 2)
}

function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $p  = New-Object Security.Principal.WindowsPrincipal($id)
    return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Clear-Folder($path, $label) {
    if (Test-Path $path) {
        Write-Host "  Cleaning $label..." -ForegroundColor Gray
        Remove-Item -Path "$path\*" -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# --- run -------------------------------------------------------------------
$isAdmin   = Test-Admin
$freeStart = Get-FreeGB

Write-Host "`n=== Disk Cleanup ===" -ForegroundColor Cyan
Write-Host "Free space before: $freeStart GB`n"
if (-not $isAdmin) {
    Write-Host "Note: not running as Admin - system-level items will be skipped.`n" -ForegroundColor Yellow
}

# User temp (always available)
Clear-Folder $env:TEMP "user temp"

# System temp (needs admin)
if ($isAdmin) {
    Clear-Folder "C:\Windows\Temp" "Windows temp"
}

# Recycle Bin
Write-Host "  Emptying Recycle Bin..." -ForegroundColor Gray
Clear-RecycleBin -Force -ErrorAction SilentlyContinue

# Dev caches (skipped silently if the tool isn't installed)
if (Get-Command npm -ErrorAction SilentlyContinue) {
    Write-Host "  Clearing npm cache..." -ForegroundColor Gray
    npm cache clean --force 2>$null
}
if (Get-Command pip -ErrorAction SilentlyContinue) {
    Write-Host "  Purging pip cache..." -ForegroundColor Gray
    pip cache purge 2>$null
}

# Component store cleanup (deep + admin only - this is slow)
if ($DeepClean -and $isAdmin) {
    Write-Host "  Running component store cleanup (this can take a few minutes)..." -ForegroundColor Gray
    Dism.exe /Online /Cleanup-Image /StartComponentCleanup | Out-Null
} elseif ($DeepClean -and -not $isAdmin) {
    Write-Host "  Skipping component store cleanup - needs Admin." -ForegroundColor Yellow
}

# --- report ----------------------------------------------------------------
$freeEnd = Get-FreeGB
$freed   = [math]::Round($freeEnd - $freeStart, 2)

Write-Host "`n=== Done ===" -ForegroundColor Cyan
Write-Host "Free space after:  $freeEnd GB"
if ($freed -ge 0) {
    Write-Host "Reclaimed:         $freed GB" -ForegroundColor Green
} else {
    Write-Host "Net change:        $freed GB (something wrote to disk during cleanup)" -ForegroundColor Yellow
}