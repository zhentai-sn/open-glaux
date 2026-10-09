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
$script:PreserveDataHome = $script:ExistingInstallation -or (Test-Path -LiteralPath (Join-Path $InstallDir 'install.json'))
if (-not $script:PreserveDataHome -and (Test-Path -LiteralPath $HomeDir)) {
  $script:PreserveDataHome = @(Get-ChildItem -LiteralPath $HomeDir -Force -ErrorAction SilentlyContinue).Count -gt 0
}

$script:InfoExpanded=$false
$script:LogExpanded=$false
$script:HasLog=$false
$form = New-Object Windows.Forms.Form
$form.Text = if ($Mode -eq 'Install') { T '安装 Glaux' 'Install Glaux' } else { 'Glaux' }
$form.StartPosition='CenterScreen'; $form.MaximizeBox=$false; $form.FormBorderStyle='FixedSingle'
$form.BackColor=[Drawing.Color]::White
$form.ForeColor=[Drawing.Color]::FromArgb(30,41,59)
$form.Font=New-Object Drawing.Font('Segoe UI',10)
$form.Icon=[Drawing.SystemIcons]::Application
function Label([string]$text,[int]$x,[int]$y,[int]$width) {
  $c=New-Object Windows.Forms.Label
  $c.Text=$text; $c.Location=New-Object Drawing.Point($x,$y); $c.Size=New-Object Drawing.Size($width,26)
  $c.BackColor=[Drawing.Color]::Transparent; $form.Controls.Add($c); return $c
}
function Button([string]$text,[int]$x,[int]$y,[int]$width) {
  $c=New-Object Windows.Forms.Button
  $c.Text=$text; $c.Location=New-Object Drawing.Point($x,$y); $c.Size=New-Object Drawing.Size($width,42)
  $c.FlatStyle='Flat'; $c.FlatAppearance.BorderSize=0; $c.UseVisualStyleBackColor=$false
  $c.BackColor=[Drawing.Color]::White; $c.ForeColor=[Drawing.Color]::FromArgb(71,85,105)
  $c.FlatAppearance.MouseOverBackColor=[Drawing.Color]::FromArgb(241,245,249)
  $c.Cursor=[Windows.Forms.Cursors]::Hand; $form.Controls.Add($c); return $c
}
function Primary($button) {
  $button.BackColor=[Drawing.Color]::FromArgb(37,99,235); $button.ForeColor=[Drawing.Color]::White
  $button.FlatAppearance.MouseOverBackColor=[Drawing.Color]::FromArgb(29,78,216)
  $button.Font=New-Object Drawing.Font('Segoe UI Semibold',10)
}
function TextBox([string]$text,[int]$y) {
  $c=New-Object Windows.Forms.TextBox
  $c.Text=$text; $c.Location=New-Object Drawing.Point(28,$y); $c.Size=New-Object Drawing.Size(432,28)
  $c.BorderStyle='FixedSingle'; $c.BackColor=[Drawing.Color]::White
  $c.ForeColor=[Drawing.Color]::FromArgb(71,85,105); $form.Controls.Add($c); return $c
}
$brand=Label 'G' 28 26 52
$brand.Height=52; $brand.TextAlign='MiddleCenter'; $brand.BackColor=[Drawing.Color]::FromArgb(37,99,235)
$brand.ForeColor=[Drawing.Color]::White; $brand.Font=New-Object Drawing.Font('Segoe UI Semibold',24)
$title=Label 'Glaux' 96 22 470
$title.Font=New-Object Drawing.Font('Segoe UI Semibold',24); $title.Height=45
$subtitle=Label (T '图像与视频分析' 'Image and video analysis') 98 69 470
$subtitle.ForeColor=[Drawing.Color]::FromArgb(100,116,139); $subtitle.Font=New-Object Drawing.Font('Segoe UI',9)
$card=New-Object Windows.Forms.Panel
$card.Location=New-Object Drawing.Point(24,112); $card.Size=New-Object Drawing.Size(560,190)
$card.BackColor=[Drawing.Color]::FromArgb(245,247,250); $form.Controls.Add($card)
$installLabel=Label (T '程序目录' 'Application folder') 28 125 550
$installBox=TextBox $InstallDir 154
$installBrowse=Button (T '选择…' 'Browse…') 472 147 108
$homeLabel=Label (T '数据目录 · 更新和卸载时保留' 'Data folder · kept on update and uninstall') 28 214 550
$homeBox=TextBox $HomeDir 245
$homeBrowse=Button (T '选择…' 'Browse…') 472 238 108
$space=Label '' 28 301 552
$space.Font=New-Object Drawing.Font('Segoe UI',9)
$stateLabel=Label '' 28 342 552
$stateLabel.Font=New-Object Drawing.Font('Segoe UI Semibold',13); $stateLabel.Height=32
$address=Label '' 48 169 496
$address.Parent=$card; $address.Location=New-Object Drawing.Point(24,57)
$address.ForeColor=[Drawing.Color]::FromArgb(100,116,139); $address.Font=New-Object Drawing.Font('Segoe UI',9)
$progress=New-Object Windows.Forms.ProgressBar
$progress.Size=New-Object Drawing.Size(552,6); $form.Controls.Add($progress)
$installButton=Button (T '安装并启动' 'Install and start') 28 410 552
$startButton=Button (T '启动 Glaux' 'Start Glaux') 24 108 156
$openButton=Button (T '打开 Glaux' 'Open Glaux') 24 108 156
$stopButton=Button (T '停止' 'Stop') 192 108 108
foreach($c in @($startButton,$openButton,$stopButton)) { $c.Parent=$card }
Primary $startButton; Primary $openButton; Primary $installButton
$stopButton.BackColor=[Drawing.Color]::White; $stopButton.FlatAppearance.BorderSize=1
$stopButton.FlatAppearance.BorderColor=[Drawing.Color]::FromArgb(214,222,232)
$infoButton=Button (T '安装信息' 'Installation') 24 320 130
$traceButton=Button (T '操作记录' 'Activity') 160 320 130
$logsButton=Button (T '打开日志目录' 'Open log folder') 428 515 152
$removeButton=Button (T '卸载…' 'Uninstall…') 466 320 118
$removeButton.ForeColor=[Drawing.Color]::FromArgb(185,28,28)
$log=New-Object Windows.Forms.TextBox
$log.Size=New-Object Drawing.Size(560,152); $log.Multiline=$true; $log.ReadOnly=$true; $log.ScrollBars='Vertical'
$log.BorderStyle='FixedSingle'; $log.BackColor=[Drawing.Color]::FromArgb(248,250,252)
$log.ForeColor=[Drawing.Color]::FromArgb(71,85,105)
$log.Text=T '尚无操作记录。' 'No activity yet.'
$log.Font=New-Object Drawing.Font('Consolas',9); $form.Controls.Add($log)
$hint=Label '' 28 380 552
$hint.Font=New-Object Drawing.Font('Segoe UI',9); $hint.ForeColor=[Drawing.Color]::FromArgb(100,116,139)
function UpdateLayout {
  $setup=$script:CurrentMode -eq 'Install'
  $card.Visible=-not $setup; $address.Visible=-not $setup
  foreach($c in @($installBrowse,$homeBrowse,$space,$installButton)) { $c.Visible=$setup }
  foreach($c in @($installLabel,$installBox,$homeLabel,$homeBox)) { $c.Visible=$setup -or $script:InfoExpanded }
  $infoButton.Visible=-not $setup; $removeButton.Visible=-not $setup
  $logsButton.Visible=-not $setup -and $script:InfoExpanded
  $log.Visible=$script:LogExpanded
  if($setup) {
    $stateLabel.Parent=$form; $stateLabel.Location=New-Object Drawing.Point(28,342); $stateLabel.Width=552
    $installLabel.Location=New-Object Drawing.Point(28,125); $installBox.Location=New-Object Drawing.Point(28,154)
    $homeLabel.Location=New-Object Drawing.Point(28,214); $homeBox.Location=New-Object Drawing.Point(28,245)
    $installBox.Width=432; $homeBox.Width=432; $installBox.BorderStyle='FixedSingle'; $homeBox.BorderStyle='FixedSingle'
    $progress.Parent=$form; $progress.Location=New-Object Drawing.Point(28,383); $progress.Width=552
    $progress.Visible=[bool]$script:Job
    $traceButton.Location=New-Object Drawing.Point(24,463)
    $log.Location=New-Object Drawing.Point(24,510)
    $bottom=if($script:LogExpanded){674}else{510}
    $hint.Text=T '安装后，通过桌面 Glaux 图标控制启动和停止。' 'After installation, use the Glaux desktop icon to start and stop.'
  } else {
    $stateLabel.Parent=$card; $stateLabel.Location=New-Object Drawing.Point(24,23); $stateLabel.Width=504
    $progress.Parent=$card; $progress.Location=New-Object Drawing.Point(24,169); $progress.Width=512
    $progress.Visible=[bool]$script:Job
    $traceButton.Location=New-Object Drawing.Point(160,320)
    $bottom=374
    if($script:InfoExpanded) {
      $installLabel.Location=New-Object Drawing.Point(28,$bottom); $installBox.Location=New-Object Drawing.Point(28,($bottom+26))
      $homeLabel.Location=New-Object Drawing.Point(28,($bottom+66)); $homeBox.Location=New-Object Drawing.Point(28,($bottom+92))
      $installBox.Width=552; $homeBox.Width=552; $installBox.BorderStyle='None'; $homeBox.BorderStyle='None'
      $logsButton.Location=New-Object Drawing.Point(428,($bottom+123)); $bottom+=170
    }
    $log.Location=New-Object Drawing.Point(24,$bottom)
    if($script:LogExpanded){$bottom+=164}
    $hint.Text=T '关闭此窗口，Glaux 仍会在后台运行。' 'Glaux keeps running when you close this window.'
  }
  $traceButton.Text=if($script:LogExpanded){T '收起记录' 'Hide activity'}else{T '操作记录' 'Activity'}
  $infoButton.Text=if($script:InfoExpanded){T '收起信息' 'Hide details'}else{T '安装信息' 'Installation'}
  $hint.Location=New-Object Drawing.Point(28,$bottom); $hint.Height=38
  $form.ClientSize=New-Object Drawing.Size(608,($bottom+46))
  $card.SendToBack()
}
function LogLine([string]$line) {
  if ($line -match '^GLAUX_PROGRESS\|(\d+)\|(\d+)\|(.+)$') {
    $done=[double]$Matches[1]; $total=[double]$Matches[2]
    if ($total -gt 0) { $progress.Style='Continuous'; $progress.Value=[Math]::Min(100,[int](100*$done/$total)) }
    $stateLabel.Text=(T '正在下载 · ' 'Downloading · ') + [Math]::Round($done/1MB,1) + ' MB'
    if ($total -gt 0) { $stateLabel.Text += ' / '+[Math]::Round($total/1MB,1)+' MB' }
    return
  }
  if ($line -match '^(->|→)\s+') {
    $stage=$line -replace '^(->|→)\s+',''
    if ($zh) {
      switch -Regex ($stage) {
        '^Looking up' { $stage='查询最新版本'; break }
        '^Downloading Glaux' { $stage='下载 Glaux 程序包'; break }
        '^Unpacking' { $stage='解压程序文件'; break }
        '^Downloading Node|^Installing uv|^创建 Python' { $stage='准备运行环境'; break }
        '^Setting up Glaux|^安装 Python' { $stage='安装分析组件'; break }
        '^写入 glaux' { $stage='创建桌面图标与命令入口'; break }
      }
    }
    $stateLabel.Text=$stage; $progress.Style='Marquee'
  }
  if ($line) { if(-not $script:HasLog){$log.Clear();$script:HasLog=$true}; $log.AppendText($line+[Environment]::NewLine) }
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
  $installBox.ReadOnly=-not $setup; $homeBox.ReadOnly=-not $setup
  UpdateLayout
  if($setup) { [void](ShowSpace); $stateLabel.Text=T '准备安装' 'Ready to install' }
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
      $stateLabel.Text=T '●  正在运行' '●  Running'
      $stateLabel.ForeColor=[Drawing.Color]::FromArgb(21,128,61)
      $address.Text='http://127.0.0.1:'+ $s.port +'/'
    }
  } catch {}
  if (-not $script:Running) {
    $stateLabel.Text=T '●  已停止' '●  Stopped'
    $stateLabel.ForeColor=[Drawing.Color]::FromArgb(100,116,139)
    $address.Text=T '启动后，在浏览器中使用 Glaux。' 'Start Glaux to use your workspace in the browser.'
  }
  $startButton.Visible=-not $script:Running; $openButton.Visible=$script:Running
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
  $psi.EnvironmentVariables['GLAUX_NO_BROWSER']=if ($kind -eq 'open') { '0' } else { '1' }
  $psi.EnvironmentVariables['GLAUX_NO_START']='0'
  $psi.EnvironmentVariables['GLAUX_WINDOWS_DESKTOP_SOURCE']=$PSScriptRoot
  $psi.EnvironmentVariables['LANG']=if ($zh) { 'zh_CN.UTF-8' } else { 'en_US.UTF-8' }
  $p=New-Object Diagnostics.Process
  $p.StartInfo=$psi
  try {
    [void]$p.Start()
    $script:Job=@{Process=$p; Out=$p.StandardOutput.ReadLineAsync(); Err=$p.StandardError.ReadLineAsync(); Kind=$kind}
    SetBusy $true; $stateLabel.Text=T '正在执行，请稍候…' 'Working, please wait…'
    $progress.Style='Marquee'; $progress.Visible=$true; $stateLabel.ForeColor=[Drawing.Color]::FromArgb(30,41,59)
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
      if (-not $script:PreserveDataHome -and -not $homeBox.Modified) { $homeBox.Text=Join-Path (Split-Path $box.Text) 'GlauxData' }
      [void](ShowSpace)
    } else {
      $homeBox.Modified=$true
    }
  }
  $dialog.Dispose()
}
$infoButton.Add_Click({$script:InfoExpanded=-not $script:InfoExpanded; UpdateLayout})
$traceButton.Add_Click({$script:LogExpanded=-not $script:LogExpanded; UpdateLayout})
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
        $stateLabel.Text=T '操作未完成，请查看记录。' 'Could not finish. Check activity.'
        $stateLabel.ForeColor=[Drawing.Color]::Firebrick
        $script:LogExpanded=$true; UpdateLayout
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
$form.Add_Shown({if($script:CurrentMode -eq 'Manage'){if($script:Running){[void]$openButton.Focus()}else{[void]$startButton.Focus()}}})
$timer.Start()
try { [void]$form.ShowDialog() } finally { $timer.Stop(); $timer.Dispose(); $form.Dispose() }
