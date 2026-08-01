# Apply and Publish OpenUI Hub v1.0.3

## Apply the Final Files

Extract this package, then copy its contents over the repository root while preserving the folder structure.

Do not copy the outer `OpenUIHub-Final-Handoff` folder itself into the repository.

## Validate

```powershell
cd C:\Users\admin\openui-hub
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
.\scripts\verify-source.ps1
```

## Confirm Secrets Are Not Tracked

```powershell
git status --short
git ls-files backend/.env frontend/.env backend/.venv frontend/node_modules release-dist build
```

The second command should print nothing.

## Commit the Source

```powershell
git add --all
git status --short
git diff --cached --stat
git commit -m "Release OpenUI Hub v1.0.3"
git push -u origin HEAD
```

## Merge to Main

Preferred: create a GitHub Pull Request from `release/windows-installer-v1` into `main`, review it, and merge it.

After the merge:

```powershell
git checkout main
git pull --ff-only origin main
```

## Build Release Assets

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
.\scripts\build-windows.ps1 -Version 1.0.3
.\scripts\build-installer.ps1 -Version 1.0.3
```

## Verify Release Assets

```powershell
Test-Path .\release-dist\OpenUIHub\OpenUIHub.exe
Test-Path .\release-dist\OpenUIHub\_internal\vendor\syncthing\syncthing.exe
Test-Path .\release-dist\OpenUI-Hub-Portable-v1.0.3.zip
Test-Path .\release-dist\OpenUI-Hub-Setup-v1.0.3.exe
Test-Path .\release-dist\SHA256SUMS.txt
```

All five results must be `True`.

## Required Smoke Test

1. Stop development instances and close VS Code terminals running OpenUI Hub.
2. Install `OpenUI-Hub-Setup-v1.0.3.exe`.
3. Launch it from the Start Menu.
4. Confirm Syncthing shows Online.
5. Test My Files, Sync Folders, Devices, Activity, Settings, upload, download, rename, delete, and Copy Device ID.
6. Close OpenUI Hub and launch it again.
7. Test the portable package after extraction.

## Create the GitHub Release

- Tag: `v1.0.3`
- Target: `main`
- Title: `OpenUI Hub v1.0.3 — Windows Release`
- Description: contents of `RELEASE_NOTES_v1.0.3.md`
- Upload:
  - `OpenUI-Hub-Setup-v1.0.3.exe`
  - `OpenUI-Hub-Portable-v1.0.3.zip`
  - `SHA256SUMS.txt`
- Mark as latest only after the smoke test passes.
