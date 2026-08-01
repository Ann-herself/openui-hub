# OpenUI Hub v1.0.2 — Windows Release

OpenUI Hub v1.0.2 packages the React frontend, FastAPI backend, Windows launcher, and Syncthing runtime into a user-friendly Windows distribution.

## Downloads

### Recommended

- `OpenUI-Hub-Setup-v1.0.2.exe` — standard Windows installer

### Alternative

- `OpenUI-Hub-Portable-v1.0.2.zip` — portable package
- `SHA256SUMS.txt` — file-integrity checksums

## Included in this Release

- Unified dashboard for Syncthing folders.
- File browsing and folder navigation.
- File upload and download.
- File and folder rename actions.
- File and folder deletion.
- Folder creation.
- Local and remote device views.
- Local Device ID display and copy action.
- Packaged Windows launcher.
- Bundled Syncthing runtime.
- Standard Windows installer and portable package.

## Preview Features

The Activity and Settings pages are included as preview interfaces. Their core data views are available, while additional actions and controls remain under development.

## Installation

1. Download `OpenUI-Hub-Setup-v1.0.2.exe`.
2. Close any existing OpenUI Hub or Syncthing process installed with an earlier build.
3. Run the installer.
4. Launch OpenUI Hub from the Start Menu.
5. The application opens locally at `http://127.0.0.1:8765`.

## Known Limitations

- Windows is the only packaged platform in this release.
- Existing OpenUI Hub and bundled Syncthing processes may need to be closed before upgrading.
- Activity and Settings functionality is still being expanded.
- The installer is not currently code-signed, so Windows may display a publisher warning.

## Verification

Use the values in `SHA256SUMS.txt` to verify the downloaded installer or portable archive.

## Author

OpenUI Hub was designed and developed by **Ann Miqdad**.

GitHub: https://github.com/Ann-herself
