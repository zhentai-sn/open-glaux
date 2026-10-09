param(
  [Parameter(Mandatory=$true)][string]$InstallDir,
  [Parameter(Mandatory=$true)][string]$HomeDir,
  [string]$SourceDir = $PSScriptRoot
)
$ErrorActionPreference = 'Stop'
$InstallDir = [IO.Path]::GetFullPath($InstallDir)
$HomeDir = [IO.Path]::GetFullPath($HomeDir)
if ($HomeDir.Equals($InstallDir,[StringComparison]::OrdinalIgnoreCase) -or $HomeDir.StartsWith($InstallDir.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) {
  throw 'The data folder must be outside the application folder so uninstall can keep it.'
}
$bin = Join-Path $InstallDir 'bin'
New-Item -ItemType Directory -Force -Path $bin | Out-Null
foreach ($asset in @('desktop.ps1','glaux.ico','glaux.png')) {
  Copy-Item -LiteralPath (Join-Path $SourceDir $asset) -Destination (Join-Path $bin $asset) -Force
}
[IO.File]::WriteAllText((Join-Path $InstallDir 'install.json'), (@{home=$HomeDir} | ConvertTo-Json), [Text.UTF8Encoding]::new($false))

# The explicit fallback also repairs custom-home commands in existing 0.3.0 installations.
$homeForCmd = $HomeDir.Replace('%','%%')
$cmd = "@echo off`r`nif not defined GLAUX_HOME set `"GLAUX_HOME=$homeForCmd`"`r`n`"%~dp0..\runtime\node\node.exe`" `"%~dp0..\current\launcher\glaux.mjs`" %*`r`n"
# cmd.exe reads batch files in the active Windows code page; the launcher additionally reads UTF-8 install.json.
[IO.File]::WriteAllText((Join-Path $bin 'glaux.cmd'), $cmd, [Text.Encoding]::Default)

# A content-specific filename lets Explorer refresh a changed icon without clearing its cache.
$iconDigest = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $bin 'glaux.ico')).Hash.Substring(0,12).ToLowerInvariant()
$shortcutIcon = Join-Path $bin ('glaux-' + $iconDigest + '.ico')
Copy-Item -LiteralPath (Join-Path $bin 'glaux.ico') -Destination $shortcutIcon -Force

$shell = New-Object -ComObject WScript.Shell
$powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$control = Join-Path $bin 'desktop.ps1'
foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {
  if ([string]::IsNullOrWhiteSpace($folder)) { throw 'Cannot locate the current user desktop or Start menu.' }
  New-Item -ItemType Directory -Force -Path $folder | Out-Null
  $link = $shell.CreateShortcut((Join-Path $folder 'Glaux.lnk'))
  $link.TargetPath = $powerShell
  $link.Arguments = '-NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $control + '" -Mode Manage -InstallDir "' + $InstallDir + '" -HomeDir "' + $HomeDir + '"'
  $link.WorkingDirectory = $InstallDir
  $link.WindowStyle = 7
  $link.IconLocation = $shortcutIcon + ',0'
  $link.Description = 'Glaux - start, open, stop and uninstall'
  $link.Save()
}
$userPath = [Environment]::GetEnvironmentVariable('Path','User')
$parts = @($userPath -split ';' | Where-Object { $_ })
if ($parts -notcontains $bin) { [Environment]::SetEnvironmentVariable('Path', (($parts + $bin) -join ';'), 'User') }
if (@($env:Path -split ';') -notcontains $bin) { $env:Path += ';' + $bin }
New-Item -Path 'HKCU:\Software\Glaux' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\Software\Glaux' -Name InstallDir -Value $InstallDir
Set-ItemProperty -Path 'HKCU:\Software\Glaux' -Name HomeDir -Value $HomeDir
