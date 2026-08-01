<div align="center">

# OpenUI Hub

### Self-hosted file synchronization, simplified for Windows.

[![Latest Release](https://img.shields.io/github/v/release/Ann-herself/openui-hub?style=for-the-badge)](https://github.com/Ann-herself/openui-hub/releases/latest)
[![Windows](https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4?style=for-the-badge&logo=windows)](https://github.com/Ann-herself/openui-hub/releases/latest)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

**Designed and developed by [Ann Miqdad](https://github.com/Ann-herself)**

[Download for Windows](https://github.com/Ann-herself/openui-hub/releases/latest) · [Report an issue](https://github.com/Ann-herself/openui-hub/issues)

</div>

---

## Overview

OpenUI Hub is a Windows desktop application that provides a clean interface for managing self-hosted Syncthing files, folders, and devices.

The distributed Windows package includes the React frontend, FastAPI backend, desktop launcher, and Syncthing runtime. End users do not need to install Python, Node.js, or development tools.

## Features

- Browse Syncthing folders and their contents.
- Upload and download files.
- Create, rename, and permanently delete files or folders.
- Create, pause, resume, rename, scan, open, and remove sync folders.
- View, add, edit, pause, resume, and remove remote devices.
- Copy the local Syncthing Device ID.
- Review recent activity and folder errors.
- View application, storage, version, and Syncthing settings.
- Install through a standard Windows installer or use a portable package.
- Keep application data in the current Windows user's local application directory.

## Download and Install

### Windows Installer — Recommended

1. Open the [latest release](https://github.com/Ann-herself/openui-hub/releases/latest).
2. Download `OpenUI-Hub-Setup-v1.0.3.exe`.
3. Close any previous OpenUI Hub or bundled Syncthing process.
4. Run the installer.
5. Launch **OpenUI Hub** from the Windows Start Menu.

### Portable Package

1. Download `OpenUI-Hub-Portable-v1.0.3.zip` from the latest release.
2. Extract the archive.
3. Run `OpenUIHub\OpenUIHub.exe`.

## System Requirements

- Windows 10 or Windows 11, 64-bit
- Permission to run desktop applications
- Network access when connecting additional Syncthing devices

## How It Works

OpenUI Hub runs locally and opens its interface in the default browser. The default application address is:

```text
http://127.0.0.1:8765
```

Runtime configuration, logs, and the isolated Syncthing home are stored under:

```text
%LOCALAPPDATA%\OpenUIHub
```

Synced files remain in folders selected by the user.

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React, TypeScript, Vite |
| Backend | Python, FastAPI, Uvicorn |
| Synchronization | Syncthing |
| Windows packaging | PyInstaller, Inno Setup |
| Desktop experience | Local browser interface managed by a Windows launcher |

## Project Structure

```text
openui-hub/
├── backend/             # FastAPI API and application version
├── desktop/             # Windows launcher
├── frontend/            # React and TypeScript interface
├── installer/           # Inno Setup configuration
├── scripts/             # Build and release scripts
├── vendor/              # Local build-time third-party runtime files
├── licenses/            # Third-party license texts
├── AUTHORS.md
├── LICENSE
├── README.md
└── THIRD_PARTY_NOTICES.txt
```

## Development Setup

### Requirements

- Python 3.11 or newer
- Node.js 20 or newer
- npm
- Syncthing

### Clone

```powershell
git clone https://github.com/Ann-herself/openui-hub.git
cd openui-hub
```

### Backend Environment

```powershell
python -m venv backend\.venv
.\backend\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
```

Create `backend/.env` for development only. Never commit API keys or `.env` files.

### Frontend

```powershell
cd frontend
npm ci
npm run build
cd ..
```

### Run from Source

```powershell
.\backend\.venv\Scripts\python.exe .\desktop\launcher.py
```

## Build the Windows Release

Place the Windows Syncthing executable at:

```text
vendor\syncthing\syncthing.exe
```

Then run:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
.\scripts\build-windows.ps1 -Version 1.0.3
.\scripts\build-installer.ps1 -Version 1.0.3
```

Expected release assets:

```text
release-dist\OpenUI-Hub-Setup-v1.0.3.exe
release-dist\OpenUI-Hub-Portable-v1.0.3.zip
release-dist\SHA256SUMS.txt
```

## Security and Privacy

- OpenUI Hub binds its local interface to `127.0.0.1`.
- Syncthing credentials and runtime settings are stored locally and are not committed to the repository.
- File operations are restricted to configured synchronization folders.
- The application blocks directory traversal and protects Syncthing system entries.

Do not report security-sensitive information in a public issue.

## Third-Party Software

OpenUI Hub integrates with Syncthing, which is licensed separately under MPL-2.0. See `THIRD_PARTY_NOTICES.txt` and the `licenses/` directory.

## Author

**Ann Miqdad**  
Original creator and lead developer of OpenUI Hub.

GitHub: [@Ann-herself](https://github.com/Ann-herself)

## License

OpenUI Hub is available under the [MIT License](LICENSE).
