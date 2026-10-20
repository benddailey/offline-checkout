@echo off
rem Copies offline-checkout.html from this folder to %LOCALAPPDATA%\OfflineCheckout and creates
rem the desktop shortcuts for it. Run it again from a new version's folder to update.
rem The PowerShell below the #POWERSHELL line does the work; cmd never reads past "exit /b".
setlocal
set "OC_SCRIPT=%~f0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$l = Get-Content -LiteralPath $env:OC_SCRIPT; $i = [array]::IndexOf($l, '#POWERSHELL'); Invoke-Expression ($l[($i + 1)..($l.Count - 1)] -join [char]10)"
echo.
pause
exit /b

#POWERSHELL
$ErrorActionPreference = 'Stop'
try {
  $here = Split-Path -Parent $env:OC_SCRIPT
  $html = Join-Path $here 'offline-checkout.html'
  if (-not (Test-Path -LiteralPath $html -PathType Leaf)) {
    throw "offline-checkout.html is not in $here. Keep this script in the same folder as offline-checkout.html and run it again."
  }

  # A fixed copy, so the shortcuts keep working when Downloads is cleaned out.
  $installDir = Join-Path $env:LOCALAPPDATA 'OfflineCheckout'
  $installed = Join-Path $installDir 'offline-checkout.html'
  New-Item -ItemType Directory -Force -Path $installDir | Out-Null
  Copy-Item -LiteralPath $html -Destination $installed -Force
  Unblock-File -LiteralPath $installed
  $match = Select-String -LiteralPath $installed -Pattern '<meta name="offline-checkout-version" content="([^"]+)"' | Select-Object -First 1
  $version = if ($match) { $match.Matches[0].Groups[1].Value } else { 'unknown' }

  # Chrome first (App Paths, then the usual install folders), Edge if Chrome is not installed.
  $browser = $null
  $profileName = 'OfflineCheckoutChrome'
  foreach ($root in 'HKCU:', 'HKLM:') {
    $key = Get-ItemProperty -LiteralPath "$root\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" -ErrorAction SilentlyContinue
    if ($key -and $key.'(default)') {
      $candidate = $key.'(default)'.Trim('"')
      if (Test-Path -LiteralPath $candidate -PathType Leaf) { $browser = $candidate; break }
    }
  }
  if (-not $browser) {
    $candidates = @(
      (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
      (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
      (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
    )
    $browser = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
  }
  if (-not $browser) {
    $profileName = 'OfflineCheckoutEdge'
    $candidates = @(
      (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
      (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
    )
    $browser = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
  }
  if (-not $browser) { throw 'Neither Google Chrome nor Microsoft Edge is installed on this PC.' }

  $url = ([Uri]$installed).AbsoluteUri
  $profileDir = Join-Path $env:LOCALAPPDATA $profileName
  $desktop = [Environment]::GetFolderPath('Desktop')
  $common = "--app=`"$url`" --user-data-dir=`"$profileDir`" --start-maximized --no-first-run --no-default-browser-check"

  $shell = New-Object -ComObject WScript.Shell
  function New-OcShortcut([string]$name, [string]$arguments, [string]$description) {
    $link = $shell.CreateShortcut((Join-Path $desktop "$name.lnk"))
    $link.TargetPath = $browser
    $link.Arguments = $arguments
    $link.WorkingDirectory = $installDir
    $link.IconLocation = "$browser,0"
    $link.Description = $description
    $link.Save()
  }
  New-OcShortcut 'Offline Checkout' "$common --kiosk-printing" 'Offline Checkout. Receipts print without a dialog.'
  New-OcShortcut 'Offline Checkout - printer setup' $common 'Offline Checkout with the print dialog, to choose the receipt printer.'

  Write-Host ''
  Write-Host "Installed Offline Checkout version $version" -ForegroundColor Green
  Write-Host ''
  Write-Host 'Shortcuts created on the desktop:'
  Write-Host '  Offline Checkout                   everyday use; receipts print without a dialog'
  Write-Host '  Offline Checkout - printer setup   use once to choose the receipt printer'
  Write-Host ''
  Write-Host "App file:   $installed"
  Write-Host "Browser:    $browser"
  Write-Host ''
  Write-Host 'Choose the receipt printer once on this PC:'
  Write-Host '  1. Close every Offline Checkout window.'
  Write-Host '  2. Open "Offline Checkout - printer setup", start a session and print the'
  Write-Host '     scanner card to the Receipt printer. Pick the Star printer and click Print.'
  Write-Host '  3. Close that window. From now on use "Offline Checkout".'
  Write-Host ''
  Write-Host 'To update, run this script from the new version''s folder. Your sessions are kept.'
}
catch {
  Write-Host ''
  Write-Host "Could not create the shortcuts: $($_.Exception.Message)" -ForegroundColor Red
}
