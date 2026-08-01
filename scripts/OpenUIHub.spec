# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules


PROJECT_ROOT = Path(SPEC).resolve().parent.parent

LAUNCHER_FILE = PROJECT_ROOT / "desktop" / "launcher.py"
FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"
SYNCTHING_EXE = PROJECT_ROOT / "vendor" / "syncthing" / "syncthing.exe"
LICENSES_DIR = PROJECT_ROOT / "licenses"
THIRD_PARTY_NOTICES = PROJECT_ROOT / "THIRD_PARTY_NOTICES.txt"

required_paths = (
    LAUNCHER_FILE,
    FRONTEND_DIST,
    SYNCTHING_EXE,
    LICENSES_DIR,
    THIRD_PARTY_NOTICES,
)

missing_paths = [str(path) for path in required_paths if not path.exists()]

if missing_paths:
    raise FileNotFoundError(
        "Required build inputs are missing:\n- "
        + "\n- ".join(missing_paths)
    )

hidden_imports = sorted(
    set(
        collect_submodules("uvicorn")
        + collect_submodules("fastapi")
        + collect_submodules("starlette")
        + collect_submodules("pydantic")
        + collect_submodules("httpx")
        + collect_submodules("dotenv")
    )
)

added_data = [
    (str(FRONTEND_DIST), "frontend/dist"),
    (str(LICENSES_DIR), "licenses"),
    (str(THIRD_PARTY_NOTICES), "."),
]

added_binaries = [
    (str(SYNCTHING_EXE), "vendor/syncthing"),
]

analysis = Analysis(
    [str(LAUNCHER_FILE)],
    pathex=[str(PROJECT_ROOT)],
    binaries=added_binaries,
    datas=added_data,
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "pytest",
        "unittest",
        "tkinter",
    ],
    noarchive=False,
    optimize=1,
)

python_archive = PYZ(analysis.pure)

executable = EXE(
    python_archive,
    analysis.scripts,
    [],
    exclude_binaries=True,
    name="OpenUIHub",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
)

application = COLLECT(
    executable,
    analysis.binaries,
    analysis.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="OpenUIHub",
)
