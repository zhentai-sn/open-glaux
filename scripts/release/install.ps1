# Glaux installer for Windows (SDD 24 §7.7).
#
#   powershell -ExecutionPolicy Bypass -c "irm https://zhentai-sn.github.io/open-glaux/install.ps1 | iex"
#
# What this script does, and nothing else:
#   1. checks Windows, the CPU architecture, free disk space and Git for Windows (bash);
#   2. downloads the Glaux package from GitHub Releases and verifies its SHA256;
#   3. unpacks it into %LOCALAPPDATA%\Programs\Glaux;
#   4. downloads a private copy of Node.js and uv into that directory's runtime\ folder;
#   5. lets uv download Python 3.12 and the pinned, hash-checked Python packages;
#   6. adds the `glaux` command to your user PATH and Start menu / desktop shortcuts, then starts Glaux.
# It needs no administrator rights and does not change your system Python or Node.js.
# Data lives in %USERPROFILE%\.glaux and is kept on upgrade and uninstall.
#
# Environment variables: GLAUX_VERSION, GLAUX_INSTALL_DIR, GLAUX_HOME, GLAUX_DOWNLOAD_BASE,
# GLAUX_MIRROR (auto | cn | none), GLAUX_NO_BROWSER=1, GLAUX_NO_START=1, GLAUX_NO_SHORTCUTS=1,
# GLAUX_PACKAGE (a local glaux-<version>.zip, for testing).

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is much faster without the progress bar
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo = 'zhentai-sn/open-glaux'
$Pages = 'https://zhentai-sn.github.io/open-glaux'
$NodeVersion = '22.22.0'
$MinFreeBytes = 3GB

function Say($Message) { Write-Host $Message }
function Step($Message) { Write-Host ''; Write-Host "-> $Message" }
function Die($Message) {
  Write-Host ''
  Write-Host "glaux install failed: $Message" -ForegroundColor Red
  Write-Host 'Re-run the same command to retry; finished steps are skipped.'
  throw "glaux install failed: $Message"
}
function Fetch($Url, $OutFile) {
  for ($i = 1; $i -le 3; $i++) {
    try { Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $OutFile -TimeoutSec 600; return }
    catch { if ($i -eq 3) { Die "download failed: $Url ($($_.Exception.Message))" } }
  }
}
function Sha256($Path) { (Get-FileHash -Algorithm SHA256 -Path $Path).Hash.ToLowerInvariant() }
function EnvOr($Name, $Default) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) { return $Default } else { return $value }
}

# ---------------------------------------------------------------- 1. system checks
if ($env:OS -ne 'Windows_NT') { Die 'this installer is for Windows; use install.sh on macOS and Linux' }
$arch = $env:PROCESSOR_ARCHITECTURE
if ($env:PROCESSOR_ARCHITEW6432) { $arch = $env:PROCESSOR_ARCHITEW6432 }
if ($arch -ne 'AMD64') { Die "only 64-bit x86 Windows is supported (found $arch)" }

$InstallDir = EnvOr 'GLAUX_INSTALL_DIR' (Join-Path $env:LOCALAPPDATA 'Programs\Glaux')
$env:GLAUX_HOME = EnvOr 'GLAUX_HOME' (Join-Path $env:USERPROFILE '.glaux')
New-Item -ItemType Directory -Force -Path $InstallDir, $env:GLAUX_HOME | Out-Null

$drive = (Get-Item $InstallDir).PSDrive
if ($drive.Free -and $drive.Free -lt $MinFreeBytes) { Die "at least 3 GB of free disk space is needed on $($drive.Name):" }

$bash = $null
foreach ($root in @("$env:ProgramFiles\Git", "${env:ProgramFiles(x86)}\Git", "$env:LOCALAPPDATA\Programs\Git")) {
  if (Test-Path "$root\bin\bash.exe") { $bash = "$root\bin\bash.exe"; break }
}
if (-not $bash) {
  $git = Get-Command git.exe -ErrorAction SilentlyContinue
  if ($git) {
    $gitRoot = Split-Path (Split-Path $git.Source)
    if ((Split-Path $git.Source) -match 'mingw64\\bin$') { $gitRoot = Split-Path $gitRoot }
    if (Test-Path "$gitRoot\bin\bash.exe") { $bash = "$gitRoot\bin\bash.exe" }
  }
}
if (-not $bash) {
  Say 'Git for Windows was not found. Glaux installs anyway, but the agent cannot run shell commands'
  Say 'until you install it:  winget install Git.Git   (or https://git-scm.com/download/win)'
}

$mirror = EnvOr 'GLAUX_MIRROR' 'auto'
if ($mirror -eq 'auto') {
  try { Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com' -Method Head -TimeoutSec 8 | Out-Null; $mirror = 'none' }
  catch { $mirror = 'cn'; Say 'GitHub is slow or unreachable; using mirrors in China for Node.js, Python and PyPI.' }
}
$env:GLAUX_MIRROR = $mirror

$work = Join-Path ([IO.Path]::GetTempPath()) "glaux-install-$PID"
New-Item -ItemType Directory -Force -Path $work | Out-Null
try {
  # -------------------------------------------------------------- 2. package
  if ($env:GLAUX_PACKAGE) {
    $package = $env:GLAUX_PACKAGE
    if (-not (Test-Path $package)) { Die "GLAUX_PACKAGE not found: $package" }
    if ((Split-Path -Leaf $package) -notmatch '^glaux-([0-9.]+)\.zip$') { Die 'GLAUX_PACKAGE must be named glaux-<version>.zip' }
    $version = $Matches[1]
    $sums = Join-Path (Split-Path $package) 'SHA256SUMS'
  } else {
    $version = $env:GLAUX_VERSION
    if (-not $version) {
      Step 'Looking up the latest version'
      try { $version = (Invoke-RestMethod -UseBasicParsing -Uri "$Pages/latest.json" -TimeoutSec 30).version }
      catch { Die "cannot read $Pages/latest.json" }
    }
    $base = EnvOr 'GLAUX_DOWNLOAD_BASE' "https://github.com/$Repo/releases/download/v$version"
    Step "Downloading Glaux $version"
    $package = Join-Path $work "glaux-$version.zip"
    $sums = Join-Path $work 'SHA256SUMS'
    Fetch "$base/glaux-$version.zip" $package
    Fetch "$base/SHA256SUMS" $sums
  }

  if (Test-Path $sums) {
    $line = Select-String -Path $sums -Pattern " glaux-$([regex]::Escape($version))\.zip$" | Select-Object -First 1
    if (-not $line -or ($line.Line -split '\s+')[0] -ne (Sha256 $package)) { Die "SHA256 mismatch for glaux-$version.zip" }
    Say 'SHA256 verified.'
  } elseif (-not $env:GLAUX_PACKAGE) {
    Die 'SHA256SUMS is missing'
  }

  $target = Join-Path $InstallDir "versions\$version"
  if (-not (Test-Path (Join-Path $target 'VERSION'))) {
    Step "Unpacking into $target"
    if (Test-Path $target) { Remove-Item -Recurse -Force $target }
    $unpack = Join-Path $work 'unpack'
    Expand-Archive -Path $package -DestinationPath $unpack -Force
    New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
    Move-Item -Path (Join-Path $unpack "glaux-$version") -Destination $target
  }

  # -------------------------------------------------------------- 3. Node.js
  $nodeDir = Join-Path $InstallDir 'runtime\node'
  $nodeExe = Join-Path $nodeDir 'node.exe'
  $haveNode = (Test-Path $nodeExe) -and ((& $nodeExe --version) -eq "v$NodeVersion")
  if (-not $haveNode) {
    Step "Downloading Node.js $NodeVersion"
    $nodeBase = if ($mirror -eq 'cn') { "https://npmmirror.com/mirrors/node/v$NodeVersion" } else { "https://nodejs.org/dist/v$NodeVersion" }
    $nodeName = "node-v$NodeVersion-win-x64"
    Fetch "$nodeBase/$nodeName.zip" (Join-Path $work 'node.zip')
    Fetch "$nodeBase/SHASUMS256.txt" (Join-Path $work 'node.sums')
    $expected = ((Select-String -Path (Join-Path $work 'node.sums') -Pattern " $nodeName\.zip$").Line -split '\s+')[0]
    if ($expected -ne (Sha256 (Join-Path $work 'node.zip'))) { Die 'Node.js SHA256 mismatch' }
    Expand-Archive -Path (Join-Path $work 'node.zip') -DestinationPath (Join-Path $work 'node') -Force
    if (Test-Path $nodeDir) { Remove-Item -Recurse -Force $nodeDir }
    New-Item -ItemType Directory -Force -Path (Split-Path $nodeDir) | Out-Null
    Move-Item -Path (Join-Path $work "node\$nodeName") -Destination $nodeDir
  }

  # -------------------------------------------------------------- 4. uv
  $uvDir = Join-Path $InstallDir 'runtime\uv'
  if (-not (Test-Path (Join-Path $uvDir 'uv.exe'))) {
    Step 'Installing uv'
    Fetch 'https://astral.sh/uv/install.ps1' (Join-Path $work 'uv-install.ps1')
    $env:UV_INSTALL_DIR = $uvDir
    $env:UV_NO_MODIFY_PATH = '1'
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $work 'uv-install.ps1') | Out-Null
    if (-not (Test-Path (Join-Path $uvDir 'uv.exe'))) { Die 'cannot install uv' }
  }

  # -------------------------------------------------------------- 5–6. Python, command, start
  Step "Setting up Glaux $version"
  & $nodeExe (Join-Path $target 'launcher\glaux.mjs') install
  if ($LASTEXITCODE -ne 0) { Die 'setup failed (see the messages above)' }

  if ($env:GLAUX_NO_START -ne '1') {
    & $nodeExe (Join-Path $InstallDir 'current\launcher\glaux.mjs') start
    if ($LASTEXITCODE -ne 0) { Die 'Glaux did not start; run glaux doctor' }
  }
  Say ''
  Say 'Done. Open a new terminal to use: glaux start | stop | status | open | update | uninstall | doctor'
} finally {
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $work
}
