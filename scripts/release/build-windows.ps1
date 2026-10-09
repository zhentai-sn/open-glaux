param([string]$OutDir = (Join-Path $PSScriptRoot '..\..\dist\windows'))
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
foreach ($relative in @('launcher\windows\desktop.ps1','launcher\windows\install-desktop.ps1','scripts\release\install.ps1')) {
  $tokens=$null; $errors=$null
  [void][Management.Automation.Language.Parser]::ParseFile((Join-Path $root $relative),[ref]$tokens,[ref]$errors)
  if ($errors) { throw ($relative + ': ' + $errors[0].Message) }
}
$OutDir = [IO.Path]::GetFullPath($OutDir)
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw '.NET Framework C# compiler was not found.' }
$output = Join-Path $OutDir 'Glaux-Setup.exe'
$arguments = @('/nologo','/target:winexe','/platform:x64','/optimize+',('/out:'+$output),'/reference:System.Windows.Forms.dll',
  ('/resource:'+(Join-Path $root 'launcher\windows\desktop.ps1')+',Glaux.desktop.ps1'),
  ('/resource:'+(Join-Path $root 'launcher\windows\install-desktop.ps1')+',Glaux.install-desktop.ps1'),
  ('/resource:'+(Join-Path $root 'scripts\release\install.ps1')+',Glaux.install.ps1'),
  ('/win32icon:'+(Join-Path $root 'launcher\windows\glaux.ico')),
  ('/resource:'+(Join-Path $root 'launcher\windows\glaux.ico')+',Glaux.glaux.ico'),
  ('/resource:'+(Join-Path $root 'launcher\windows\glaux.png')+',Glaux.glaux.png'),
  (Join-Path $root 'launcher\windows\Setup.cs'))
$info = New-Object Diagnostics.ProcessStartInfo
$info.FileName = $compiler
$info.Arguments = ($arguments | ForEach-Object { '"' + $_.Replace('"','\"') + '"' }) -join ' '
$info.UseShellExecute = $false
$info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
$process = New-Object Diagnostics.Process
$process.StartInfo = $info
[void]$process.Start()
$stdout = $process.StandardOutput.ReadToEndAsync(); $stderr = $process.StandardError.ReadToEndAsync()
$process.WaitForExit()
Write-Host $stdout.GetAwaiter().GetResult()
Write-Host $stderr.GetAwaiter().GetResult()
$code = $process.ExitCode; $process.Dispose()
if ($code -ne 0) { throw 'Windows setup compilation failed.' }
$digest = (Get-FileHash -Algorithm SHA256 -LiteralPath $output).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $OutDir 'WINDOWS-SHA256SUMS'), "$digest  Glaux-Setup.exe`n", [Text.UTF8Encoding]::new($false))
Write-Host "Built $output"
