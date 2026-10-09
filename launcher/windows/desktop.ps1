param(
  [ValidateSet('Install','Manage')][string]$Mode = 'Manage',
  [string]$InstallDir,
  [string]$HomeDir,
  [string]$InstallerScript
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
trap { [void][Windows.Forms.MessageBox]::Show($_.Exception.Message,'Glaux','OK','Error'); break }
[Windows.Forms.Application]::EnableVisualStyles()
$zh = [Globalization.CultureInfo]::CurrentUICulture.Name -like 'zh*'
function T([string]$cn,[string]$en) { if ($zh) { $cn } else { $en } }
function Quote([string]$value) { "'" + $value.Replace("'","''") + "'" }
if (-not $InstallDir) {
  $saved = Get-ItemProperty 'HKCU:\Software\Glaux' -ErrorAction SilentlyContinue
  $InstallDir = if ($saved -and $saved.InstallDir) { $saved.InstallDir } else { Join-Path $env:LOCALAPPDATA 'Programs\Glaux' }
  if (-not $HomeDir -and $saved) { $HomeDir = $saved.HomeDir }
}
if (-not $HomeDir) {
  $config = Join-Path $InstallDir 'install.json'
  if (Test-Path -LiteralPath $config) { $HomeDir = (Get-Content -LiteralPath $config -Raw -Encoding UTF8 | ConvertFrom-Json).home }
  if (-not $HomeDir) { $HomeDir = Join-Path $env:USERPROFILE '.glaux' }
}
$script:Job = $null
$script:CurrentMode = $Mode
$script:Running = $false
$script:DataHome = $HomeDir
$script:Dir = $InstallDir
$script:ExistingInstallation = Test-Path -LiteralPath (Join-Path $InstallDir 'current\VERSION')

$form = New-Object Windows.Forms.Form
$form.Text = if ($Mode -eq 'Install') { T '安装 Glaux' 'Install Glaux' } else { 'Glaux' }
$form.ClientSize = New-Object Drawing.Size(720,600)
$form.MinimumSize = $form.Size
$form.StartPosition = 'CenterScreen'
$form.BackColor = [Drawing.Color]::White
$form.Font = New-Object Drawing.Font('Segoe UI',10)
$form.Icon = [Drawing.SystemIcons]::Application
function Label([string]$text,[int]$x,[int]$y,[int]$width) {
  $c = New-Object Windows.Forms.Label
  $c.Text=$text; $c.Location=New-Object Drawing.Point($x,$y); $c.Size=New-Object Drawing.Size($width,26)
  $form.Controls.Add($c); return $c
}
function Button([string]$text,[int]$x,[int]$y,[int]$width) {
  $c=New-Object Windows.Forms.Button
  $c.Text=$text; $c.Location=New-Object Drawing.Point($x,$y); $c.Size=New-Object Drawing.Size($width,34)
  $c.FlatStyle='System'; $form.Controls.Add($c); return $c
}
function TextBox([string]$text,[int]$y) {
  $c=New-Object Windows.Forms.TextBox
  $c.Text=$text; $c.Location=New-Object Drawing.Point(28,$y); $c.Size=New-Object Drawing.Size(555,28)
  $form.Controls.Add($c); return $c
}
$title=Label 'Glaux' 28 22 650
$title.Font=New-Object Drawing.Font('Segoe UI',22,[Drawing.FontStyle]::Bold); $title.Height=45
$subtitle=Label (T '本机图像与视频分析 · 启动和停止都在这里' 'Local image and video analysis · start and stop here') 28 72 650
$installLabel=Label (T '程序目录' 'Application folder') 28 112 500
$installBox=TextBox $InstallDir 141
$installBrowse=Button (T '选择…' 'Browse…') 595 138 96
$homeLabel=Label (T '数据目录（更新和普通卸载时保留）' 'Data folder (kept on update and uninstall)') 28 178 650
$homeBox=TextBox $HomeDir 207
$homeBrowse=Button (T '选择…' 'Browse…') 595 204 96
$space=Label '' 28 247 663
$stateLabel=Label '' 28 280 663
$stateLabel.Font=New-Object Drawing.Font('Segoe UI',11,[Drawing.FontStyle]::Bold)
$progress=New-Object Windows.Forms.ProgressBar
$progress.Location=New-Object Drawing.Point(28,313); $progress.Size=New-Object Drawing.Size(663,14)
$form.Controls.Add($progress)
$installButton=Button (T '安装并启动' 'Install and start') 28 345 155
$startButton=Button (T '启动' 'Start') 28 345 110
$openButton=Button (T '打开' 'Open') 148 345 110
$stopButton=Button (T '停止' 'Stop') 268 345 110
$logsButton=Button (T '日志目录' 'Logs') 388 345 110
$removeButton=Button (T '卸载' 'Uninstall') 508 345 110
$log=New-Object Windows.Forms.TextBox
$log.Location=New-Object Drawing.Point(28,395); $log.Size=New-Object Drawing.Size(663,166)
$log.Multiline=$true; $log.ReadOnly=$true; $log.ScrollBars='Vertical'
$log.Font=New-Object Drawing.Font('Consolas',9); $form.Controls.Add($log)
$hint=Label (T '关闭此窗口不会停止已启动的 Glaux。' 'Closing this window does not stop Glaux.') 28 568 663
function LogLine([string]$line) {
  if ($line -match '^GLAUX_PROGRESS\|(\d+)\|(\d+)\|(.+)$') {
    $done=[double]$Matches[1]; $total=[double]$Matches[2]
    if ($total -gt 0) { $progress.Style='Continuous'; $progress.Value=[Math]::Min(100,[int](100*$done/$total)) }
    $stateLabel.Text=(T '正在下载 ' 'Downloading ') + $Matches[3] + ' · ' + [Math]::Round($done/1MB,1) + ' MB'
    return
  }
  if ($line.StartsWith('-> ') -or $line.StartsWith('→ ')) { $stateLabel.Text=$line.Substring(3); $progress.Style='Marquee' }
  if ($line) { $log.AppendText($line+[Environment]::NewLine) }
}
function ShowSpace {
  try {
    if (-not [IO.Path]::IsPathRooted($installBox.Text)) { throw 'Choose an absolute local path.' }
    $drive=New-Object IO.DriveInfo([IO.Path]::GetPathRoot([IO.Path]::GetFullPath($installBox.Text)))
    $gb=[Math]::Round($drive.AvailableFreeSpace/1GB,2)
    $space.Text=(T '目标盘可用空间：' 'Available on destination drive: ') + $gb + ' GiB' + (T '；安装至少需要 3 GiB' '; installation requires at least 3 GiB')
    $space.ForeColor=if ($drive.AvailableFreeSpace -lt 3GB) { [Drawing.Color]::Firebrick } else { [Drawing.Color]::DimGray }
    return $drive.AvailableFreeSpace -ge 3GB
  } catch { $space.Text=T '请选择有效的本地绝对路径。' 'Choose a valid absolute local path.'; return $false }
}
function ShowMode {
  $setup=$script:CurrentMode -eq 'Install'
  foreach ($c in @($installBrowse,$homeBrowse,$space,$installButton,$progress)) { $c.Visible=$setup }
  foreach ($c in @($startButton,$openButton,$stopButton,$logsButton,$removeButton)) { $c.Visible=-not $setup }
  $installBox.ReadOnly=-not $setup; $homeBox.ReadOnly=-not $setup
  if ($setup) { [void](ShowSpace); $stateLabel.Text=T '选择目录，然后开始安装。' 'Choose your folders, then install.' }
}
function RefreshState {
  if ($script:CurrentMode -ne 'Manage' -or $script:Job) { return }
  $script:Running=$false
  try {
    $s=Get-Content -LiteralPath (Join-Path $script:DataHome 'run\state.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if (Get-Process -Id $s.agent_pid -ErrorAction SilentlyContinue) {
      $request=[Net.WebRequest]::Create('http://127.0.0.1:'+ $s.port + '/agent-api/v1/health')
      $request.Timeout=300; $response=$request.GetResponse(); $response.Close()
      $script:Running=$true
      $stateLabel.Text=(T '运行中 · ' 'Running · ')+'http://127.0.0.1:'+ $s.port +'/'
    }
  } catch {}
  if (-not $script:Running) { $stateLabel.Text=T '已停止' 'Stopped' }
  $startButton.Enabled=-not $script:Running
  $openButton.Enabled=$script:Running; $stopButton.Enabled=$script:Running
}
function SetBusy([bool]$busy) {
  foreach ($c in @($installButton,$installBrowse,$homeBrowse,$startButton,$openButton,$stopButton,$removeButton)) { $c.Enabled=-not $busy }
  $installBox.ReadOnly=$busy -or $script:CurrentMode -ne 'Install'
  $homeBox.ReadOnly=$busy -or $script:CurrentMode -ne 'Install'
}
function BeginJob([string]$kind,[string]$command) {
  if ($script:Job) { return }
  $psi=New-Object Diagnostics.ProcessStartInfo
  $psi.FileName=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $prefix='[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $ErrorActionPreference="Stop"; '
  $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($prefix+$command))
  $psi.Arguments='-NoProfile -NonInteractive -InputFormat Text -OutputFormat Text -ExecutionPolicy Bypass -EncodedCommand '+$encoded
  $psi.UseShellExecute=$false; $psi.CreateNoWindow=$true
  $psi.RedirectStandardOutput=$true; $psi.RedirectStandardError=$true
  $psi.StandardOutputEncoding=[Text.Encoding]::UTF8; $psi.StandardErrorEncoding=[Text.Encoding]::UTF8
  $psi.EnvironmentVariables['GLAUX_INSTALL_DIR']=$script:Dir
  $psi.EnvironmentVariables['GLAUX_HOME']=$script:DataHome
  $psi.EnvironmentVariables['GLAUX_NO_BROWSER']='1'
  $psi.EnvironmentVariables['GLAUX_NO_START']='0'
  $psi.EnvironmentVariables['GLAUX_WINDOWS_DESKTOP_SOURCE']=$PSScriptRoot
  $psi.EnvironmentVariables['LANG']=if ($zh) { 'zh_CN.UTF-8' } else { 'en_US.UTF-8' }
  $p=New-Object Diagnostics.Process
  $p.StartInfo=$psi
  try {
    [void]$p.Start()
    $script:Job=@{Process=$p; Out=$p.StandardOutput.ReadLineAsync(); Err=$p.StandardError.ReadLineAsync(); Kind=$kind}
    SetBusy $true; $stateLabel.Text=T '正在执行，请稍候…' 'Working, please wait…'
    $progress.Style='Marquee'; $progress.Visible=$true
  } catch { [void][Windows.Forms.MessageBox]::Show($_.Exception.Message,'Glaux'); $p.Dispose() }
}
function RunGlaux([string]$command) {
  $node=Join-Path $script:Dir 'runtime\node\node.exe'
  $entry=Join-Path $script:Dir 'current\launcher\glaux.mjs'
  BeginJob $command ('& '+(Quote $node)+' '+(Quote $entry)+' '+$command+'; exit $LASTEXITCODE')
}
function BrowseFolder($box) {
  $dialog=New-Object Windows.Forms.FolderBrowserDialog
  $dialog.Description=T '选择目录' 'Choose a folder'
  if (Test-Path -LiteralPath $box.Text) { $dialog.SelectedPath=$box.Text }
  if ($dialog.ShowDialog() -eq 'OK') {
    $box.Text=$dialog.SelectedPath
    if ($box -eq $installBox) {
      if ((Split-Path $box.Text -Leaf) -ne 'Glaux') { $box.Text=Join-Path $box.Text 'Glaux' }
      if (-not $script:ExistingInstallation -and -not $homeBox.Modified) { $homeBox.Text=Join-Path (Split-Path $box.Text) 'GlauxData' }
      [void](ShowSpace)
    }
  }
  $dialog.Dispose()
}
$installBrowse.Add_Click({ BrowseFolder $installBox })
$homeBrowse.Add_Click({ BrowseFolder $homeBox })
$installBox.Add_TextChanged({ if ($script:CurrentMode -eq 'Install') { [void](ShowSpace) } })
$installButton.Add_Click({
  if (-not (ShowSpace)) { [void][Windows.Forms.MessageBox]::Show($space.Text,'Glaux'); return }
  if (-not [IO.Path]::IsPathRooted($homeBox.Text)) { [void][Windows.Forms.MessageBox]::Show((T '请选择绝对数据目录。' 'Choose an absolute data folder.'),'Glaux'); return }
  $script:Dir=[IO.Path]::GetFullPath($installBox.Text); $script:DataHome=[IO.Path]::GetFullPath($homeBox.Text)
  if ($script:Dir.TrimEnd('\') -eq [IO.Path]::GetPathRoot($script:Dir).TrimEnd('\')) {
    [void][Windows.Forms.MessageBox]::Show((T '请选择盘符下的 Glaux 子目录。' 'Choose a Glaux subfolder, not a drive root.'),'Glaux'); return
  }
  if ((Test-Path -LiteralPath $script:Dir) -and -not (Test-Path -LiteralPath (Join-Path $script:Dir 'current\VERSION'))) {
    $foreign=@(Get-ChildItem -LiteralPath $script:Dir -Force | Where-Object { $_.Name -notin @('.setup-cache','runtime','versions','bin','install.json') })
    if ($foreign.Count -gt 0) { [void][Windows.Forms.MessageBox]::Show((T '此目录已有其他文件，请选择新的 Glaux 子目录。' 'This folder contains other files. Choose a new Glaux subfolder.'),'Glaux'); return }
  }
  $prefix=$script:Dir.TrimEnd('\')+'\'
  if ($script:DataHome.Equals($script:Dir,[StringComparison]::OrdinalIgnoreCase) -or $script:DataHome.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) {
    [void][Windows.Forms.MessageBox]::Show((T '数据目录必须在程序目录之外，才能在卸载时保留。' 'The data folder must be outside the application folder so uninstall can keep it.'),'Glaux'); return
  }
  if (-not (Test-Path -LiteralPath $InstallerScript)) { [void][Windows.Forms.MessageBox]::Show('Installer script missing. Download Glaux-Setup.exe again.','Glaux'); return }
  BeginJob 'install' ('& '+(Quote $InstallerScript)+'; exit 0')
})
$startButton.Add_Click({ RunGlaux 'start' })
$openButton.Add_Click({ RunGlaux 'open' })
$stopButton.Add_Click({ RunGlaux 'stop' })
$logsButton.Add_Click({
  $folder=Join-Path $script:DataHome 'logs'
  if (Test-Path -LiteralPath $folder) { Start-Process explorer.exe -ArgumentList ('"'+$folder+'"') }
})
$removeButton.Add_Click({
  $answer=[Windows.Forms.MessageBox]::Show((T '卸载 Glaux？用户数据会保留。' 'Uninstall Glaux? Your data will be kept.'),'Glaux','YesNo','Question')
  if ($answer -eq 'Yes') { RunGlaux 'uninstall' }
})
$timer=New-Object Windows.Forms.Timer
$timer.Interval=150
$script:Tick=0
$timer.Add_Tick({
  $job=$script:Job
  if ($job) {
    foreach ($stream in @('Out','Err')) {
      for ($i=0; $i -lt 50 -and $job[$stream] -and $job[$stream].IsCompleted; $i++) {
        $line=$job[$stream].GetAwaiter().GetResult()
        if ($null -eq $line) { $job[$stream]=$null; break }
        LogLine $line
        $reader=if ($stream -eq 'Out') { $job.Process.StandardOutput } else { $job.Process.StandardError }
        $job[$stream]=$reader.ReadLineAsync()
      }
    }
    if ($job.Process.HasExited -and -not $job.Out -and -not $job.Err) {
      $code=$job.Process.ExitCode; $kind=$job.Kind
      $job.Process.Dispose(); $script:Job=$null; SetBusy $false; $progress.Visible=$false
      if ($code -ne 0) {
        $stateLabel.Text=T '操作未完成，请查看下方日志后重试。' 'Could not finish. Check the log below and retry.'
        [void][Windows.Forms.MessageBox]::Show($stateLabel.Text,'Glaux','OK','Error')
      } elseif ($kind -eq 'uninstall') {
        [void][Windows.Forms.MessageBox]::Show((T 'Glaux 已卸载，数据保留在：' 'Glaux was uninstalled. Data remains in: ')+$script:DataHome,'Glaux'); $form.Close()
      } else {
        if ($kind -eq 'install') { $script:CurrentMode='Manage'; $form.Text='Glaux'; ShowMode }
        RefreshState
        if ($kind -eq 'install' -or $kind -eq 'start') { RunGlaux 'open' }
      }
    }
  } else {
    $script:Tick++
    if ($script:Tick -ge 14) { $script:Tick=0; RefreshState }
  }
})
$form.Add_FormClosing({ param($sender,$eventArgs)
  if ($script:Job) { $eventArgs.Cancel=$true; [void][Windows.Forms.MessageBox]::Show((T '操作进行中，请完成后再关闭。' 'Please wait for the operation to finish before closing.'),'Glaux') }
})
ShowMode
RefreshState
$timer.Start()
try { [void]$form.ShowDialog() } finally { $timer.Stop(); $timer.Dispose(); $form.Dispose() }
