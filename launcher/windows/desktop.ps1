param(
  [ValidateSet('Install','Manage')][string]$Mode = 'Manage',
  [string]$InstallDir,
  [string]$HomeDir,
  [string]$InstallerScript
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()

$zh = [Globalization.CultureInfo]::CurrentUICulture.Name -like 'zh*'
function T([string]$cn,[string]$en) { if ($zh) { $cn } else { $en } }
function Quote([string]$value) { "'" + $value.Replace("'","''") + "'" }

# --- 路径解析（与 0.3.x 行为一致） --------------------------------------------
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
$script:InfoExpanded = $false
$script:LogExpanded = $false
$script:HasLog = $false
$script:DataHome = $HomeDir
$script:Dir = $InstallDir
$script:ExistingInstallation = Test-Path -LiteralPath (Join-Path $InstallDir 'current\VERSION')
$script:PreserveDataHome = $script:ExistingInstallation -or (Test-Path -LiteralPath (Join-Path $InstallDir 'install.json'))
if (-not $script:PreserveDataHome -and (Test-Path -LiteralPath $HomeDir)) {
  $script:PreserveDataHome = @(Get-ChildItem -LiteralPath $HomeDir -Force -ErrorAction SilentlyContinue).Count -gt 0
}
$script:Busy = $false
$script:Marquee = $null

# --- 文案 --------------------------------------------------------------------
$S = @{
  install_title  = T '安装 Glaux' 'Install Glaux'
  subtitle       = T '将所见转化为洞见' 'Turning sight into insight'
  app_folder     = T '程序目录' 'Application folder'
  data_folder    = T '数据目录 · 更新和卸载时保留' 'Data folder · kept on update and uninstall'
  browse         = T '选择…' 'Browse…'
  install_start  = T '安装并启动' 'Install and start'
  preparing      = T '准备安装' 'Ready to install'
  start          = T '启动 Glaux' 'Start Glaux'
  open           = T '打开 Glaux' 'Open Glaux'
  stop           = T '停止' 'Stop'
  working        = T '正在执行，请稍候…' 'Working, please wait…'
  activity       = T '操作记录' 'Activity'
  hide_activity  = T '收起记录' 'Hide activity'
  installation   = T '安装信息' 'Installation'
  hide_details   = T '收起信息' 'Hide details'
  uninstall      = T '卸载…' 'Uninstall…'
  open_logs      = T '打开日志目录' 'Open log folder'
  no_activity    = T '尚无操作记录。' 'No activity yet.'
  hint_manage    = T '关闭此窗口，Glaux 仍会在后台运行。' 'Glaux keeps running when you close this window.'
  hint_install   = T '安装完成后，用桌面 Glaux 图标启动、打开或停止。' 'After installation, use the Glaux desktop icon to start, open or stop.'
  stopped        = T '已停止' 'Stopped'
  running        = T '正在运行' 'Running'
  addr_stopped   = T '启动后即可在浏览器中使用' 'Start Glaux to use it in your browser'
  installing     = T '正在安装…' 'Installing…'
  space_ok       = T '目标盘可用 {0} GiB' 'Available on destination drive: {0} GiB'
  space_low      = T '目标盘仅剩 {0} GiB，安装至少需要 3 GiB' 'Only {0} GiB left; installation needs at least 3 GiB'
  failed         = T '操作未完成，请查看记录。' 'Could not finish. Check activity.'
  close_busy     = T '操作进行中，请完成后再关闭。' 'Please wait for the operation to finish before closing.'
  uninstall_q    = T '卸载 Glaux？用户数据会保留。' 'Uninstall Glaux? Your data will be kept.'
  uninstalled    = T 'Glaux 已卸载，数据保留在：' 'Glaux was uninstalled. Data remains in: '
  choose_abs_dir = T '请选择绝对数据目录。' 'Choose an absolute data folder.'
  choose_subdir  = T '请选择盘符下的 Glaux 子目录。' 'Choose a Glaux subfolder, not a drive root.'
  dir_not_empty  = T '此目录已有其他文件，请选择新的 Glaux 子目录。' 'This folder contains other files. Choose a new Glaux subfolder.'
  data_outside   = T '数据目录必须在程序目录之外，才能在卸载时保留。' 'The data folder must be outside the application folder so uninstall can keep it.'
  choose_valid   = T '请选择有效的本地绝对路径。' 'Choose a valid local absolute path.'
  driver_missing = 'Installer script missing. Download Glaux-Setup.exe again.'
}

# --- 外观 --------------------------------------------------------------------
# 与 DeepSeek Harness 安装器同一种语言：无边框、大量留白、单一强调色、细进度条。
$accent = '#7C4DD6'      # 品牌紫，取自 glaux.svg
$accentDeep = '#6A3EC2'
$ink = '#111827'
$muted = '#6B7280'
$line = '#E5E7EB'
$soft = '#F6F3FE'

$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="Glaux" Width="720" Height="540" WindowStyle="None" AllowsTransparency="True"
        Background="Transparent" ResizeMode="NoResize" WindowStartupLocation="CenterScreen"
        UseLayoutRounding="True" SnapsToDevicePixels="True" TextOptions.TextFormattingMode="Display"
        FontFamily="Segoe UI, Microsoft YaHei UI, Microsoft YaHei" Foreground="__INK__">
  <Window.Resources>
    <Style x:Key="Chrome" TargetType="Button">
      <Setter Property="Width" Value="40"/>
      <Setter Property="Height" Value="30"/>
      <Setter Property="Background" Value="Transparent"/>
      <Setter Property="BorderThickness" Value="0"/>
      <Setter Property="Foreground" Value="__MUTED__"/>
      <Setter Property="FontSize" Value="12"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="Bg" Background="{TemplateBinding Background}" CornerRadius="8">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True">
                <Setter TargetName="Bg" Property="Background" Value="#F1F2F5"/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
    <Style x:Key="Primary" TargetType="Button">
      <Setter Property="Height" Value="46"/>
      <Setter Property="Background" Value="__ACCENT__"/>
      <Setter Property="Foreground" Value="White"/>
      <Setter Property="FontSize" Value="14"/>
      <Setter Property="FontWeight" Value="SemiBold"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="Bg" Background="{TemplateBinding Background}" CornerRadius="12">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True">
                <Setter TargetName="Bg" Property="Background" Value="__ACCENTDEEP__"/>
              </Trigger>
              <Trigger Property="IsEnabled" Value="False">
                <Setter TargetName="Bg" Property="Opacity" Value="0.45"/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
    <Style x:Key="Secondary" TargetType="Button">
      <Setter Property="Height" Value="46"/>
      <Setter Property="Background" Value="White"/>
      <Setter Property="Foreground" Value="#374151"/>
      <Setter Property="FontSize" Value="14"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="Bg" Background="{TemplateBinding Background}" CornerRadius="12"
                    BorderBrush="__LINE__" BorderThickness="1">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True">
                <Setter TargetName="Bg" Property="Background" Value="#F9FAFB"/>
              </Trigger>
              <Trigger Property="IsEnabled" Value="False">
                <Setter TargetName="Bg" Property="Opacity" Value="0.45"/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
    <Style x:Key="Link" TargetType="Button">
      <Setter Property="Background" Value="Transparent"/>
      <Setter Property="BorderThickness" Value="0"/>
      <Setter Property="Foreground" Value="__MUTED__"/>
      <Setter Property="FontSize" Value="12"/>
      <Setter Property="Padding" Value="0"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border Background="Transparent">
              <ContentPresenter VerticalAlignment="Center"/>
            </Border>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
    <Style x:Key="Field" TargetType="TextBox">
      <Setter Property="BorderThickness" Value="0"/>
      <Setter Property="Background" Value="Transparent"/>
      <Setter Property="FontSize" Value="12.5"/>
      <Setter Property="Foreground" Value="#374151"/>
      <Setter Property="VerticalContentAlignment" Value="Center"/>
      <Setter Property="CaretBrush" Value="__ACCENT__"/>
    </Style>
    <Style x:Key="FieldBox" TargetType="Border">
      <Setter Property="CornerRadius" Value="10"/>
      <Setter Property="Background" Value="#FBFBFC"/>
      <Setter Property="BorderBrush" Value="__LINE__"/>
      <Setter Property="BorderThickness" Value="1"/>
      <Setter Property="Height" Value="42"/>
    </Style>
  </Window.Resources>

  <Border x:Name="Shell" CornerRadius="16" Background="White">
    <Border.Effect>
      <DropShadowEffect BlurRadius="28" ShadowDepth="0" Opacity="0.18" Color="#000000"/>
    </Border.Effect>
    <Grid>
      <Grid.RowDefinitions>
        <RowDefinition Height="40"/>
        <RowDefinition Height="*"/>
      </Grid.RowDefinitions>

      <Grid x:Name="TitleBar" Grid.Row="0" Background="Transparent">
        <StackPanel Orientation="Horizontal" Margin="18,0,0,0" VerticalAlignment="Center">
          <Image x:Name="TitleMark" Width="15" Height="15" RenderOptions.BitmapScalingMode="HighQuality"/>
          <TextBlock Text="Glaux" Margin="8,0,0,0" FontSize="11.5" Foreground="__MUTED__" VerticalAlignment="Center"/>
        </StackPanel>
        <StackPanel Orientation="Horizontal" HorizontalAlignment="Right" Margin="0,0,10,0" VerticalAlignment="Center">
          <Button x:Name="MinimizeButton" Style="{StaticResource Chrome}" Content="—" FontSize="13"/>
          <Button x:Name="CloseButton" Style="{StaticResource Chrome}" Content="✕" Margin="2,0,0,0"/>
        </StackPanel>
      </Grid>

      <!-- 安装 -->
      <StackPanel x:Name="InstallPanel" Grid.Row="1" Margin="40,0,40,0" VerticalAlignment="Center">
        <Border Width="96" Height="96" CornerRadius="48" Background="__SOFT__" HorizontalAlignment="Center">
          <Image x:Name="InstallMark" Width="56" Height="56" RenderOptions.BitmapScalingMode="HighQuality"/>
        </Border>
        <TextBlock Text="{T:wordmark}" FontSize="30" FontWeight="SemiBold" HorizontalAlignment="Center" Margin="0,18,0,0"/>
        <TextBlock Text="{T:subtitle}" FontSize="12" Foreground="__MUTED__" HorizontalAlignment="Center" Margin="0,6,0,0"/>

        <StackPanel x:Name="PickerPanel" Margin="0,26,0,0">
          <TextBlock Text="{T:app_folder}" FontSize="11.5" Foreground="__MUTED__"/>
          <Border Style="{StaticResource FieldBox}" Margin="0,7,0,0">
            <Grid>
              <Grid.ColumnDefinitions>
                <ColumnDefinition Width="*"/>
                <ColumnDefinition Width="Auto"/>
              </Grid.ColumnDefinitions>
              <TextBox x:Name="InstallBox" Style="{StaticResource Field}" Margin="12,0,0,0"/>
              <Button x:Name="InstallBrowse" Grid.Column="1" Style="{StaticResource Link}" Content="{T:browse}" Margin="0,0,12,0"/>
            </Grid>
          </Border>
          <TextBlock Text="{T:data_folder}" FontSize="11.5" Foreground="__MUTED__" Margin="0,14,0,0"/>
          <Border Style="{StaticResource FieldBox}" Margin="0,7,0,0">
            <Grid>
              <Grid.ColumnDefinitions>
                <ColumnDefinition Width="*"/>
                <ColumnDefinition Width="Auto"/>
              </Grid.ColumnDefinitions>
              <TextBox x:Name="HomeBox" Style="{StaticResource Field}" Margin="12,0,0,0"/>
              <Button x:Name="HomeBrowse" Grid.Column="1" Style="{StaticResource Link}" Content="{T:browse}" Margin="0,0,12,0"/>
            </Grid>
          </Border>
          <TextBlock x:Name="SpaceLine" FontSize="11.5" Foreground="__MUTED__" Margin="0,10,0,0"/>
          <Button x:Name="InstallButton" Style="{StaticResource Primary}" Content="{T:install_start}" Margin="0,18,0,0"/>
        </StackPanel>

        <StackPanel x:Name="InstallProgress" Margin="0,26,0,0" Visibility="Collapsed">
          <Grid>
            <TextBlock x:Name="InstallStatus" FontSize="13" Foreground="#374151" VerticalAlignment="Center"/>
            <TextBlock x:Name="InstallPercent" FontSize="12.5" Foreground="__MUTED__" HorizontalAlignment="Right" VerticalAlignment="Center"/>
          </Grid>
          <Border Height="4" CornerRadius="2" Background="#EEF0F3" Margin="0,12,0,0">
            <Border x:Name="InstallTrack" HorizontalAlignment="Left" CornerRadius="2" Background="__ACCENT__" Width="0"/>
          </Border>
        </StackPanel>

        <TextBlock x:Name="InstallHint" Text="{T:hint_install}" FontSize="11.5" Foreground="__MUTED__"
                   TextAlignment="Center" HorizontalAlignment="Center" TextWrapping="Wrap"
                   MaxWidth="560" Margin="0,30,0,0"/>
      </StackPanel>

      <!-- 运行控制 -->
      <StackPanel x:Name="ManagePanel" Grid.Row="1" Margin="40,0,40,0" VerticalAlignment="Center" Visibility="Collapsed">
        <Border Width="88" Height="88" CornerRadius="44" Background="__SOFT__" HorizontalAlignment="Center">
          <Image x:Name="ManageMark" Width="50" Height="50" RenderOptions.BitmapScalingMode="HighQuality"/>
        </Border>
        <TextBlock Text="{T:wordmark}" FontSize="27" FontWeight="SemiBold" HorizontalAlignment="Center" Margin="0,16,0,0"/>
        <TextBlock Text="{T:subtitle}" FontSize="12" Foreground="__MUTED__" HorizontalAlignment="Center" Margin="0,5,0,0"/>

        <StackPanel Orientation="Horizontal" HorizontalAlignment="Center" Margin="0,24,0,0">
          <Ellipse x:Name="StatusDot" Width="7" Height="7" Fill="__MUTED__" VerticalAlignment="Center"/>
          <TextBlock x:Name="StatusText" FontSize="14.5" FontWeight="SemiBold" Margin="8,0,0,0" VerticalAlignment="Center"/>
        </StackPanel>
        <TextBlock x:Name="AddressText" FontSize="12" Foreground="__MUTED__" HorizontalAlignment="Center" Margin="0,6,0,0"/>

        <Grid Margin="0,22,0,0">
          <Grid.ColumnDefinitions>
            <ColumnDefinition Width="*"/>
            <ColumnDefinition Width="12"/>
            <ColumnDefinition Width="168"/>
          </Grid.ColumnDefinitions>
          <Button x:Name="StartButton" Grid.Column="0" Style="{StaticResource Primary}" Content="{T:start}"/>
          <Button x:Name="OpenButton" Grid.Column="0" Style="{StaticResource Primary}" Content="{T:open}" Visibility="Collapsed"/>
          <Button x:Name="StopButton" Grid.Column="2" Style="{StaticResource Secondary}" Content="{T:stop}"/>
        </Grid>

        <Border x:Name="ManageProgress" Height="4" CornerRadius="2" Background="#EEF0F3" Margin="0,16,0,0" Visibility="Collapsed">
          <Border x:Name="ManageTrack" HorizontalAlignment="Left" CornerRadius="2" Background="__ACCENT__" Width="0"/>
        </Border>

        <StackPanel x:Name="InfoPanel" Margin="0,18,0,0" Visibility="Collapsed">
          <TextBlock Text="{T:app_folder}" FontSize="11.5" Foreground="__MUTED__"/>
          <TextBlock x:Name="InfoInstall" FontFamily="Consolas" FontSize="11.5" Foreground="#374151" TextTrimming="CharacterEllipsis" Margin="0,3,0,0"/>
          <TextBlock Text="{T:data_folder}" FontSize="11.5" Foreground="__MUTED__" Margin="0,10,0,0"/>
          <TextBlock x:Name="InfoHome" FontFamily="Consolas" FontSize="11.5" Foreground="#374151" TextTrimming="CharacterEllipsis" Margin="0,3,0,0"/>
          <Button x:Name="LogsButton" Style="{StaticResource Link}" Content="{T:open_logs}" HorizontalAlignment="Left" Margin="0,10,0,0"/>
        </StackPanel>

        <Border x:Name="LogPanel" Margin="0,16,0,0" Background="#F8FAFC" BorderBrush="__LINE__" BorderThickness="1"
                CornerRadius="10" Height="132" Visibility="Collapsed">
          <TextBox x:Name="LogBox" Background="Transparent" BorderThickness="0" IsReadOnly="True"
                   FontFamily="Consolas" FontSize="11" Foreground="#4B5563" Margin="10,8,10,8"
                   VerticalScrollBarVisibility="Auto" TextWrapping="NoWrap" IsTabStop="False"/>
        </Border>

        <TextBlock x:Name="HintText" FontSize="11.5" Foreground="__MUTED__" TextAlignment="Center"
                   HorizontalAlignment="Center" Margin="0,18,0,0" TextWrapping="Wrap" MaxWidth="560"/>

        <Grid Margin="0,16,0,20">
          <StackPanel Orientation="Horizontal" HorizontalAlignment="Left">
            <Button x:Name="InfoButton" Style="{StaticResource Link}" Content="{T:installation}"/>
            <TextBlock Text="·" Foreground="#D1D5DB" Margin="10,0,10,0" VerticalAlignment="Center"/>
            <Button x:Name="TraceButton" Style="{StaticResource Link}" Content="{T:activity}"/>
          </StackPanel>
          <Button x:Name="RemoveButton" Style="{StaticResource Link}" Content="{T:uninstall}"
                  HorizontalAlignment="Right" Foreground="#B91C1C"/>
        </Grid>
      </StackPanel>
    </Grid>
  </Border>
</Window>
'@

$strings = @{
  subtitle = $S.subtitle; app_folder = $S.app_folder; data_folder = $S.data_folder
  browse = $S.browse; install_start = $S.install_start; start = $S.start; open = $S.open
  stop = $S.stop; activity = $S.activity; installation = $S.installation; uninstall = $S.uninstall
  open_logs = $S.open_logs; wordmark = 'Glaux'; hint_install = $S.hint_install
}
$markup = [regex]::Replace($xaml, '\{T:([a-z_]+)\}', { param($m) $strings[$m.Groups[1].Value] })
$markup = $markup.Replace('__ACCENTDEEP__', $accentDeep).Replace('__ACCENT__', $accent).
  Replace('__INK__', $ink).Replace('__MUTED__', $muted).Replace('__LINE__', $line).Replace('__SOFT__', $soft)

$window = [Windows.Markup.XamlReader]::Parse($markup)

function N([string]$name) { $window.FindName($name) }
$shell = N 'Shell'
$titleBar = N 'TitleBar'
$installPanel = N 'InstallPanel'
$managePanel = N 'ManagePanel'
$pickerPanel = N 'PickerPanel'
$installProgress = N 'InstallProgress'
$installTrack = N 'InstallTrack'
$installStatus = N 'InstallStatus'
$installPercent = N 'InstallPercent'
$manageTrack = N 'ManageTrack'
$manageProgress = N 'ManageProgress'
$installBox = N 'InstallBox'
$homeBox = N 'HomeBox'
$spaceLine = N 'SpaceLine'
$installButton = N 'InstallButton'
$installBrowse = N 'InstallBrowse'
$homeBrowse = N 'HomeBrowse'
$startButton = N 'StartButton'
$openButton = N 'OpenButton'
$stopButton = N 'StopButton'
$statusDot = N 'StatusDot'
$statusText = N 'StatusText'
$addressText = N 'AddressText'
$infoButton = N 'InfoButton'
$traceButton = N 'TraceButton'
$removeButton = N 'RemoveButton'
$logsButton = N 'LogsButton'
$infoPanel = N 'InfoPanel'
$infoInstall = N 'InfoInstall'
$infoHome = N 'InfoHome'
$logPanel = N 'LogPanel'
$logBox = N 'LogBox'
$hintText = N 'HintText'
$minimizeButton = N 'MinimizeButton'
$closeButton = N 'CloseButton'

# --- 图标与字体 ---------------------------------------------------------------
$pngPath = Join-Path $PSScriptRoot 'glaux.png'
$bitmap = New-Object Windows.Media.Imaging.BitmapImage
$bitmap.BeginInit(); $bitmap.CacheOption = 'OnLoad'; $bitmap.UriSource = [Uri]::new($pngPath); $bitmap.EndInit()
$bitmap.Freeze()
foreach ($name in 'TitleMark','InstallMark','ManageMark') { (N $name).Source = $bitmap }
$window.Icon = $bitmap

# --- 进度条 -------------------------------------------------------------------
$script:TrackWidth = 0
function SyncTrackWidth { $script:TrackWidth = $shell.ActualWidth - 80; if ($script:TrackWidth -lt 0) { $script:TrackWidth = 560 } }
function SetProgress([double]$percent) {
  StopMarquee
  $p = [Math]::Max(0, [Math]::Min(100, $percent))
  $installTrack.Width = [Math]::Round($script:TrackWidth * $p / 100.0)
  $installPercent.Text = if ($p -gt 0) { "$([int]$p)%" } else { '' }
}
function StartMarquee {
  if ($script:Marquee) { return }
  if ($script:CurrentMode -eq 'Install') {
    $track = $installTrack
  } else {
    $manageProgress.Visibility = 'Visible'
    $track = $manageTrack
  }
  $track.Visibility = 'Visible'
  $track.Width = 120
  $anim = New-Object Windows.Media.Animation.DoubleAnimation
  $anim.From = 0; $anim.To = [Math]::Max(0, $script:TrackWidth - 120); $anim.Duration = [Windows.Duration]::new([TimeSpan]::FromSeconds(1.1))
  $anim.AutoReverse = $true
  $story = New-Object Windows.Media.Animation.Storyboard
  [Windows.Media.Animation.Storyboard]::SetTarget($anim, $track)
  [Windows.Media.Animation.Storyboard]::SetTargetProperty($anim, [Windows.PropertyPath]::new('Width'))
  $story.Children.Add($anim)
  $story.Begin()
  $script:Marquee = $story
}
function StopMarquee {
  if ($script:Marquee) { $script:Marquee.Stop(); $script:Marquee = $null }
  $manageProgress.Visibility = 'Collapsed'
  $manageTrack.Width = 0
}

# --- 布局 ---------------------------------------------------------------------
function ApplyMode {
  $setup = $script:CurrentMode -eq 'Install'
  $installPanel.Visibility = if ($setup) { 'Visible' } else { 'Collapsed' }
  $managePanel.Visibility = if ($setup) { 'Collapsed' } else { 'Visible' }
  $window.Title = if ($setup) { $S.install_title } else { 'Glaux' }
  $installBox.IsReadOnly = -not $setup
  $homeBox.IsReadOnly = -not $setup
  $pickerPanel.Visibility = if ($script:Job -or ($setup -and $script:Installing)) { 'Collapsed' } else { 'Visible' }
  $installProgress.Visibility = if ($script:Job -or ($setup -and $script:Installing)) { 'Visible' } else { 'Collapsed' }
  $hintText.Text = if ($setup) { $S.hint_install } else { $S.hint_manage }
  $infoPanel.Visibility = if ($script:InfoExpanded) { 'Visible' } else { 'Collapsed' }
  $logPanel.Visibility = if ($script:LogExpanded) { 'Visible' } else { 'Collapsed' }
  $infoButton.Content = if ($script:InfoExpanded) { $S.hide_details } else { $S.installation }
  $traceButton.Content = if ($script:LogExpanded) { $S.hide_activity } else { $S.activity }
  $infoInstall.Text = $script:Dir
  $infoHome.Text = $script:DataHome
  SyncTrackWidth
  if ($setup) {
    $window.Height = 560
  } else {
    $height = 500
    if ($script:LogExpanded) { $height += 148 }
    if ($script:InfoExpanded) { $height += 74 }
    $window.Height = $height
  }
}

# --- 安装位置与空间 -----------------------------------------------------------
function ShowSpace {
  try {
    if (-not [IO.Path]::IsPathRooted($installBox.Text)) { throw $S.choose_valid }
    $drive = New-Object IO.DriveInfo([IO.Path]::GetPathRoot([IO.Path]::GetFullPath($installBox.Text)))
    $gb = [Math]::Round($drive.AvailableFreeSpace / 1GB, 2)
    if ($drive.AvailableFreeSpace -ge 3GB) {
      $spaceLine.Text = ($S.space_ok -f $gb)
      $spaceLine.Foreground = [Windows.Media.Brushes]::Gray
    } else {
      $spaceLine.Text = ($S.space_low -f $gb)
      $spaceLine.Foreground = [Windows.Media.Brushes]::Firebrick
    }
    return $drive.AvailableFreeSpace -ge 3GB
  } catch {
    $spaceLine.Text = $S.choose_valid
    $spaceLine.Foreground = [Windows.Media.Brushes]::Firebrick
    return $false
  }
}

function RefreshState {
  if ($script:CurrentMode -ne 'Manage' -or $script:Job) { return }
  $script:Running = $false
  try {
    $s = Get-Content -LiteralPath (Join-Path $script:DataHome 'run\state.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if (Get-Process -Id $s.agent_pid -ErrorAction SilentlyContinue) {
      $request = [Net.WebRequest]::Create('http://127.0.0.1:' + $s.port + '/agent-api/v1/health')
      $request.Timeout = 300
      $response = $request.GetResponse(); $response.Close()
      $script:Running = $true
    }
  } catch { }
  if ($script:Running) {
    $statusText.Text = $S.running
    $statusText.Foreground = [Windows.Media.BrushConverter]::new().ConvertFromString('#15803D')
    $statusDot.Fill = [Windows.Media.BrushConverter]::new().ConvertFromString('#22C55E')
    $addressText.Text = 'http://127.0.0.1:' + $s.port + '/'
  } else {
    $statusText.Text = $S.stopped
    $statusText.Foreground = [Windows.Media.BrushConverter]::new().ConvertFromString($ink)
    $statusDot.Fill = [Windows.Media.BrushConverter]::new().ConvertFromString('#CBD5E1')
    $addressText.Text = $S.addr_stopped
  }
  $startButton.Visibility = if ($script:Running) { 'Collapsed' } else { 'Visible' }
  $openButton.Visibility = if ($script:Running) { 'Visible' } else { 'Collapsed' }
  $startButton.IsEnabled = -not $script:Running -and -not $script:Busy
  $openButton.IsEnabled = $script:Running -and -not $script:Busy
  $stopButton.IsEnabled = $script:Running -and -not $script:Busy
}

function SetBusy([bool]$busy) {
  $script:Busy = $busy
  foreach ($c in @($installButton, $installBrowse, $homeBrowse, $startButton, $openButton, $stopButton, $removeButton)) { $c.IsEnabled = -not $busy }
  $installBox.IsReadOnly = $busy -or $script:CurrentMode -ne 'Install'
  $homeBox.IsReadOnly = $busy -or $script:CurrentMode -ne 'Install'
}

# --- 子进程与日志 -------------------------------------------------------------
function LogLine([string]$line) {
  if ($line -match '^GLAUX_PROGRESS\|(\d+)\|(\d+)\|(.+)$') {
    $done = [double]$Matches[1]; $total = [double]$Matches[2]
    if ($total -gt 0) { SetProgress (100.0 * $done / $total) }
    $state = $S.installing
    if ($total -gt 0) { $state = $S.installing + '  ' + [Math]::Round($done / 1MB, 1) + ' / ' + [Math]::Round($total / 1MB, 1) + ' MB' }
    $installStatus.Text = $state
    return
  }
  if ($line -match '^(->|→)\s+') {
    $stage = $line -replace '^(->|→)\s+', ''
    if ($zh) {
      switch -Regex ($stage) {
        '^Looking up' { $stage = '查询最新版本'; break }
        '^Downloading Glaux' { $stage = '下载 Glaux 程序包'; break }
        '^Unpacking' { $stage = '解压程序文件'; break }
        '^Downloading Node|^Installing uv|^创建 Python' { $stage = '准备运行环境'; break }
        '^Setting up Glaux|^安装 Python' { $stage = '安装分析组件'; break }
        '^写入 glaux' { $stage = '创建桌面图标与命令入口'; break }
      }
    }
    $installStatus.Text = $stage
    $installPercent.Text = ''
    StartMarquee
  }
  if ($line) {
    if (-not $script:HasLog) { $logBox.Clear(); $script:HasLog = $true }
    $logBox.AppendText($line + [Environment]::NewLine)
    $logBox.ScrollToEnd()
  }
}

function BeginJob([string]$kind, [string]$command) {
  if ($script:Job) { return }
  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $prefix = '[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $ErrorActionPreference="Stop"; '
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($prefix + $command))
  $psi.Arguments = '-NoProfile -NonInteractive -InputFormat Text -OutputFormat Text -ExecutionPolicy Bypass -EncodedCommand ' + $encoded
  $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
  $psi.StandardOutputEncoding = [Text.Encoding]::UTF8
  $psi.StandardErrorEncoding = [Text.Encoding]::UTF8
  $psi.EnvironmentVariables['GLAUX_INSTALL_DIR'] = $script:Dir
  $psi.EnvironmentVariables['GLAUX_HOME'] = $script:DataHome
  $psi.EnvironmentVariables['GLAUX_NO_BROWSER'] = if ($kind -eq 'open') { '0' } else { '1' }
  $psi.EnvironmentVariables['GLAUX_NO_START'] = '0'
  $psi.EnvironmentVariables['GLAUX_WINDOWS_DESKTOP_SOURCE'] = $PSScriptRoot
  $psi.EnvironmentVariables['LANG'] = if ($zh) { 'zh_CN.UTF-8' } else { 'en_US.UTF-8' }
  $p = New-Object Diagnostics.Process
  $p.StartInfo = $psi
  try {
    [void]$p.Start()
    $script:Job = @{ Process = $p; Out = $p.StandardOutput.ReadLineAsync(); Err = $p.StandardError.ReadLineAsync(); Kind = $kind }
    SetBusy $true
    $installStatus.Text = $S.working
    StartMarquee
    ApplyMode
  } catch {
    [void][Windows.MessageBox]::Show($_.Exception.Message, 'Glaux')
    $p.Dispose()
  }
}

function RunGlaux([string]$command) {
  $node = Join-Path $script:Dir 'runtime\node\node.exe'
  $entry = Join-Path $script:Dir 'current\launcher\glaux.mjs'
  BeginJob $command ('& ' + (Quote $node) + ' ' + (Quote $entry) + ' ' + $command + '; exit $LASTEXITCODE')
}

function BrowseFolder($box) {
  $dialog = New-Object Windows.Forms.FolderBrowserDialog
  $dialog.Description = T '选择目录' 'Choose a folder'
  if (Test-Path -LiteralPath $box.Text) { $dialog.SelectedPath = $box.Text }
  if ($dialog.ShowDialog() -eq 'OK') {
    $box.Text = $dialog.SelectedPath
    if ($box -eq $installBox) {
      if ((Split-Path $box.Text -Leaf) -ne 'Glaux') { $box.Text = Join-Path $box.Text 'Glaux' }
      if (-not $script:PreserveDataHome -and -not $script:HomeTouched) { $homeBox.Text = Join-Path (Split-Path $box.Text) 'GlauxData' }
      [void](ShowSpace)
    } else {
      $script:HomeTouched = $true
    }
  }
  $dialog.Dispose()
}

# --- 事件 ---------------------------------------------------------------------
$titleBar.Add_MouseLeftButtonDown({ param($s, $e) try { $window.DragMove() } catch { } })
$minimizeButton.Add_Click({ $window.WindowState = 'Minimized' })
$closeButton.Add_Click({
  if ($script:Job) {
    [void][Windows.MessageBox]::Show($S.close_busy, 'Glaux')
    return
  }
  $window.Close()
})
$installBrowse.Add_Click({ BrowseFolder $installBox })
$homeBrowse.Add_Click({ BrowseFolder $homeBox })
$installBox.Add_TextChanged({ if ($script:CurrentMode -eq 'Install' -and -not $script:Job) { [void](ShowSpace) } })
$infoButton.Add_Click({ $script:InfoExpanded = -not $script:InfoExpanded; ApplyMode })
$traceButton.Add_Click({ $script:LogExpanded = -not $script:LogExpanded; ApplyMode })
$logsButton.Add_Click({
  $folder = Join-Path $script:DataHome 'logs'
  if (Test-Path -LiteralPath $folder) { Start-Process explorer.exe -ArgumentList ('"' + $folder + '"') }
})
$removeButton.Add_Click({
  $answer = [Windows.MessageBox]::Show($S.uninstall_q, 'Glaux', 'YesNo', 'Question')
  if ($answer -eq 'Yes') { RunGlaux 'uninstall' }
})
$startButton.Add_Click({ RunGlaux 'start' })
$openButton.Add_Click({ RunGlaux 'open' })
$stopButton.Add_Click({ RunGlaux 'stop' })

$installButton.Add_Click({
  if (-not (ShowSpace)) { [void][Windows.MessageBox]::Show($spaceLine.Text, 'Glaux'); return }
  if (-not [IO.Path]::IsPathRooted($homeBox.Text)) { [void][Windows.MessageBox]::Show($S.choose_abs_dir, 'Glaux'); return }
  $script:Dir = [IO.Path]::GetFullPath($installBox.Text)
  $script:DataHome = [IO.Path]::GetFullPath($homeBox.Text)
  if ($script:Dir.TrimEnd('\') -eq [IO.Path]::GetPathRoot($script:Dir).TrimEnd('\')) {
    [void][Windows.MessageBox]::Show($S.choose_subdir, 'Glaux'); return
  }
  if ((Test-Path -LiteralPath $script:Dir) -and -not (Test-Path -LiteralPath (Join-Path $script:Dir 'current\VERSION'))) {
    $foreign = @(Get-ChildItem -LiteralPath $script:Dir -Force | Where-Object { $_.Name -notin @('.setup-cache', 'runtime', 'versions', 'bin', 'install.json') })
    if ($foreign.Count -gt 0) { [void][Windows.MessageBox]::Show($S.dir_not_empty, 'Glaux'); return }
  }
  $prefix = $script:Dir.TrimEnd('\') + '\'
  if ($script:DataHome.Equals($script:Dir, [StringComparison]::OrdinalIgnoreCase) -or $script:DataHome.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    [void][Windows.MessageBox]::Show($S.data_outside, 'Glaux'); return
  }
  if (-not (Test-Path -LiteralPath $InstallerScript)) { [void][Windows.MessageBox]::Show($S.driver_missing, 'Glaux'); return }
  $script:Installing = $true
  BeginJob 'install' ('& ' + (Quote $InstallerScript) + '; exit 0')
})

# --- 轮询 ---------------------------------------------------------------------
$timer = New-Object Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromMilliseconds(150)
$script:Tick = 0
$timer.Add_Tick({
  $job = $script:Job
  if ($job) {
    foreach ($stream in @('Out', 'Err')) {
      for ($i = 0; $i -lt 50 -and $job[$stream] -and $job[$stream].IsCompleted; $i++) {
        $line = $job[$stream].GetAwaiter().GetResult()
        if ($null -eq $line) { $job[$stream] = $null; break }
        LogLine $line
        $reader = if ($stream -eq 'Out') { $job.Process.StandardOutput } else { $job.Process.StandardError }
        $job[$stream] = $reader.ReadLineAsync()
      }
    }
    if ($job.Process.HasExited -and -not $job.Out -and -not $job.Err) {
      $code = $job.Process.ExitCode; $kind = $job.Kind
      $job.Process.Dispose(); $script:Job = $null; $script:Installing = $false
      StopMarquee; SetProgress 0
      $installProgress.Visibility = 'Collapsed'
      SetBusy $false
      if ($code -ne 0) {
        $installStatus.Text = $S.failed
        $script:LogExpanded = $true
        ApplyMode
        [void][Windows.MessageBox]::Show($S.failed, 'Glaux', 'OK', 'Error')
      } elseif ($kind -eq 'uninstall') {
        [void][Windows.MessageBox]::Show(($S.uninstalled + $script:DataHome), 'Glaux')
        $window.Close()
      } else {
        if ($kind -eq 'install') { $script:CurrentMode = 'Manage'; ApplyMode }
        RefreshState
        if ($kind -eq 'install' -or $kind -eq 'start') { RunGlaux 'open' }
      }
    }
  } else {
    $script:Tick++
    if ($script:Tick -ge 14) { $script:Tick = 0; RefreshState }
  }
})

$shell.Add_SizeChanged({ SyncTrackWidth })

# --- 启动 ---------------------------------------------------------------------
$installBox.Text = $script:Dir
$homeBox.Text = $script:DataHome
$statusText.Text = $S.stopped
$addressText.Text = $S.addr_stopped
$logBox.Text = $S.no_activity
ApplyMode
if ($script:CurrentMode -eq 'Install') { [void](ShowSpace) }
RefreshState
$window.Add_ContentRendered({
  SyncTrackWidth
  if ($script:CurrentMode -eq 'Manage') {
    if ($script:Running) { [void]$openButton.Focus() } else { [void]$startButton.Focus() }
  }
  # 文档与走查用的离屏快照：设了 GLAUX_UI_SNAPSHOT 才生效，正常启动不受影响。
  if ($env:GLAUX_UI_SNAPSHOT) {
    $window.Dispatcher.BeginInvoke([Windows.Threading.DispatcherPriority]::ApplicationIdle, [Action]{
      $rtb = New-Object Windows.Media.Imaging.RenderTargetBitmap([int]$window.ActualWidth, [int]$window.ActualHeight, 96, 96, [Windows.Media.PixelFormats]::Pbgra32)
      $rtb.Render($shell)
      $encoder = New-Object Windows.Media.Imaging.PngBitmapEncoder
      $encoder.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($rtb))
      $stream = [IO.File]::Create($env:GLAUX_UI_SNAPSHOT)
      try { $encoder.Save($stream) } finally { $stream.Close() }
      $window.Close()
    }) | Out-Null
  }
})
$timer.Start()
try { [void]$window.ShowDialog() } finally { $timer.Stop() }
