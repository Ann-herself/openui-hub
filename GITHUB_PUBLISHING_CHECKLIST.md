# OpenUI Hub GitHub Publishing Checklist

## 1. Put the Release Branch on `main`

Recommended professional workflow:

1. Open the repository on GitHub.
2. Create a Pull Request:
   - Base: `main`
   - Compare: `release/windows-installer-v1`
3. Title: `Release OpenUI Hub v1.0.2`
4. Review the changed files.
5. Merge the Pull Request.
6. Delete the release branch only after confirming `main` works.

Command-line alternative:

```powershell
git checkout main
git pull --ff-only origin main
git merge --ff-only release/windows-installer-v1
git push origin main
```

If the fast-forward merge fails, use the GitHub Pull Request method instead.

## 2. Replace the Existing README

Copy the supplied `README.md` to the repository root.

## 3. Add Author Attribution

Add `AUTHORS.md` to the repository root.

Confirm Git identity:

```powershell
git config user.name
git config user.email
git log -1 --format="%an <%ae>"
```

Use an email address verified on the GitHub account so commits are attributed correctly.

## 4. Add Screenshots

Create:

```text
docs/images/
```

Recommended files:

```text
dashboard.png
files.png
devices.png
activity.png
settings.png
```

Use clean screenshots without VS Code, terminals, personal notifications, or unrelated browser tabs.

## 5. Create GitHub Release

On GitHub:

1. Open `Releases`.
2. Select `Draft a new release`.
3. Create tag: `v1.0.2`
4. Target: `main`
5. Release title: `OpenUI Hub v1.0.2 — Windows Release`
6. Paste the supplied release notes.
7. Upload:
   - `OpenUI-Hub-Setup-v1.0.2.exe`
   - `OpenUI-Hub-Portable-v1.0.2.zip`
   - `SHA256SUMS.txt`
8. Mark it as the latest release.
9. Publish.

## 6. Configure Repository About Section

Description:

```text
A user-friendly Windows interface for managing self-hosted Syncthing files, folders, and devices.
```

Topics:

```text
syncthing
self-hosted
file-manager
fastapi
react
typescript
vite
python
windows
desktop-app
```

## 7. Add a Social Preview

Repository Settings → General → Social preview.

Recommended size: 1280 × 640 px.

Include:

- OpenUI Hub logo
- Product name
- “Self-hosted file synchronization, simplified”
- “Developed by Ann Miqdad”

## 8. Pin the Repository

Open the GitHub profile and pin `openui-hub` so it appears among the featured projects.

## 9. Final Git Commit

```powershell
git add README.md AUTHORS.md
git commit -m "Improve project documentation and release presentation"
git push origin main
```

## 10. Final Public Check

Open the repository in an incognito browser and verify:

- README renders correctly.
- Latest release is visible.
- Installer downloads successfully.
- Screenshots load.
- Author section shows Ann Miqdad.
- No `.env`, credentials, local paths, logs, or user data are public.
