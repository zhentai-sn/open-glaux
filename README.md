<h1 align="center">🦉 Glaux</h1>
<p align="center"><strong>Turning sight into insight</strong></p>
<p align="center"><a href="README.zh-CN.md">简体中文</a> · <strong>English</strong></p>

Glaux is a local agent harness for image and video analysis. Bring a compatible model; Glaux provides the workspace, tools and evidence needed to inspect media and review results.

## Install

**macOS or Linux** (Ubuntu 22.04+ x64; macOS 13+ Intel or Apple silicon):

```sh
curl -fsSL https://zhentai-sn.github.io/open-glaux/install.sh | sh
```

**Windows 10/11 x64** (PowerShell; Git for Windows is needed for shell commands):

Recommended: [download the Windows installer](https://github.com/zhentai-sn/open-glaux/releases/latest/download/Glaux-Setup.exe) and double-click it. The Glaux desktop icon opens controls for starting, opening and stopping the app. PowerShell installation is also available:

```powershell
irm https://zhentai-sn.github.io/open-glaux/install.ps1 | iex
```

The installer downloads the current release, verifies its SHA-256 checksum, and prepares a private Node.js and Python runtime. No administrator rights or Docker are required. Glaux opens in your browser after installation.

To install a specific version, set `GLAUX_VERSION` before running the installer. See [installation and troubleshooting](docs/runbooks/distribution-install.md) for options and supported systems.

## What you can do

- Ask questions about images and video, including video frames and aligned audio evidence.
- Use an agent with local files, image viewing, annotation, measurement and segmentation tools.
- Review evidence, annotations and run trajectories, and keep reusable examples in Atlas.
- Bring your own model connection. API credentials and analysis data stay on your computer.

Specialized model weights are not included. Some analysis tools require their respective models to be installed separately. Glaux is not intended for clinical diagnosis.

## Commands

```sh
glaux start      # Start the local service and open Glaux
glaux stop       # Stop the service
glaux status     # Show version, port and health
glaux update     # Install the latest release
glaux doctor     # Check local prerequisites
glaux uninstall  # Remove the app and keep your data
```

User data is stored in `~/.glaux` (Windows: `%USERPROFILE%\.glaux`) and is kept when the app is updated or uninstalled. Use `glaux uninstall --purge` to remove it too.

## Documentation

- [Project site and downloads](https://zhentai-sn.github.io/open-glaux/)
- [Project charter](docs/roadmaps/charter.zh-CN.md) · [Architecture](docs/architecture.zh-CN.md)
- [Feature specifications](docs/sdd/README.md)
- [Install, run and update guide](docs/runbooks/distribution-install.md)

## License

Glaux is licensed under [Apache-2.0](LICENSE). Sample image and research data licenses and sources are documented next to the assets.
