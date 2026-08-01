<div align="center">

<img src="frontend/public/icons.svg" alt="OpenUI Hub logo" width="96">

# OpenUI Hub

### A simple desktop interface for managing self-hosted Syncthing files, folders, and devices.

[![Latest Release](https://img.shields.io/github/v/release/Ann-herself/openui-hub?display_name=tag&style=for-the-badge)](https://github.com/Ann-herself/openui-hub/releases/latest)
[![Windows](https://img.shields.io/badge/Windows-10%2F11-0078D4?style=for-the-badge&logo=windows)](https://github.com/Ann-herself/openui-hub/releases/latest)
[![Python](https://img.shields.io/badge/Python-FastAPI-3776AB?style=for-the-badge&logo=python&logoColor=white)](backend)
[![React](https://img.shields.io/badge/React-Vite-61DAFB?style=for-the-badge&logo=react&logoColor=black)](frontend)

**Designed and developed by [Ann Miqdad](https://github.com/Ann-herself)**

[Download for Windows](https://github.com/Ann-herself/openui-hub/releases/latest) ·
[Report an Issue](https://github.com/Ann-herself/openui-hub/issues) ·
[View Source](https://github.com/Ann-herself/openui-hub)

</div>

---

## Overview

OpenUI Hub provides a unified, user-friendly interface for self-hosted file synchronization.  
The current Windows release integrates with **Syncthing** and brings file, folder, and device management into one clean dashboard.

The application packages the frontend, backend, launcher, and Syncthing runtime into a Windows installer, so end users do not need to install Python, Node.js, or development tools.

## Highlights

- Browse Syncthing folders and files from one interface.
- Upload, download, rename, and delete files.
- Create and manage folders.
- View local and remote Syncthing devices.
- Copy the local Syncthing Device ID.
- Manage the application through a packaged Windows launcher.
- Run locally as a self-hosted application.
- Install through a standard Windows setup file.
- Use a portable Windows package without installation.

> **Development status:** Core file, folder, and device workflows are available.  
> Activity and Settings interfaces are currently preview features and may receive further functional improvements.

## Download

### Recommended: Windows Installer

1. Open the [latest release](https://github.com/Ann-herself/openui-hub/releases/latest).
2. Download `OpenUI-Hub-Setup-v1.0.2.exe`.
3. Run the installer.
4. Launch **OpenUI Hub** from the Start Menu.

### Portable Version

Download `OpenUI-Hub-Portable-v1.0.2.zip`, extract it, then run:

```text
OpenUIHub\OpenUIHub.exe
```

The portable package is intended for users who prefer not to install the application.

## System Requirements

- Windows 10 or Windows 11, 64-bit
- A local user account with permission to install or run desktop applications
- Network access when connecting additional Syncthing devices

## First Run

OpenUI Hub starts a local application service and opens the interface in your browser at:

```text
http://127.0.0.1:8765
```

Application data and diagnostic logs are stored under:

```text
%LOCALAPPDATA%\OpenUIHub
```

## Screenshots

Add current screenshots to `docs/images/`, then enable this section:

```markdown
![OpenUI Hub dashboard](docs/images/dashboard.png)
![Device management](docs/images/devices.png)
```

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React, TypeScript, Vite |
| Backend | Python, FastAPI, Uvicorn |
| Synchronization | Syncthing |
| Windows packaging | PyInstaller, Inno Setup |
| Local interface | Browser-based UI served by the packaged application |

## Project Structure

```text
openui-hub/
├── backend/             # FastAPI backend and Syncthing integration
├── desktop/             # Windows application launcher
├── frontend/            # React and TypeScript frontend
├── installer/           # Inno Setup installer configuration
├── scripts/             # Windows build and packaging scripts
├── licenses/            # Third-party license notices
├── vendor/              # Bundled runtime components
├── README.md
└── THIRD_PARTY_NOTICES.txt
```

## Development Setup

### Prerequisites

- Python 3.11 or newer
- Node.js and npm
- Git
- Syncthing

### Clone the Repository

```powershell
git clone https://github.com/Ann-herself/openui-hub.git
cd openui-hub
```

### Backend

```powershell
python -m venv backend\.venv
.\backend\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
```

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

### Run the Packaged-Style Launcher

From the repository root:

```powershell
.\backend\.venv\Scripts\python.exe .\desktop\launcher.py
```

## Build for Windows

Build the Windows application package:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
.\scripts\build-windows.ps1 -Version 1.0.2
```

Build the installer:

```powershell
.\scripts\build-installer.ps1 -Version 1.0.2
```

Generated release files are placed in:

```text
release-dist/
```

## Roadmap

- Complete Activity actions and filtering.
- Expand Settings controls.
- Improve update and upgrade handling.
- Add additional self-hosted integrations.
- Improve mobile and responsive access.
- Add automated release builds and tests.

## Security and Privacy

OpenUI Hub is designed to run locally. Do not commit `.env` files, credentials, API keys, Syncthing API keys, private certificates, or user data to GitHub.

To report a security issue, contact the maintainer privately rather than opening a public issue.

## Third-Party Components

OpenUI Hub integrates and bundles third-party open-source software. See:

- [`THIRD_PARTY_NOTICES.txt`](THIRD_PARTY_NOTICES.txt)
- [`licenses/`](licenses/)

Syncthing remains the property of its respective authors and contributors.

## Author

**Ann Miqdad**  
Creator, designer, and primary developer of OpenUI Hub.

- GitHub: [@Ann-herself](https://github.com/Ann-herself)
- Project repository: [Ann-herself/openui-hub](https://github.com/Ann-herself/openui-hub)

## Contributing

Issues and suggestions are welcome. Before submitting a pull request, open an issue describing the proposed change and its purpose.

## License

No project license is declared in this repository yet. All rights remain with the copyright holder unless a license file is added.

---

<div align="center">

**OpenUI Hub — developed by Ann Miqdad**

</div>
