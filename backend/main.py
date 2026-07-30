import os
import subprocess
import mimetypes
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4
from datetime import datetime, timezone
import httpx
from dotenv import load_dotenv
from fastapi import (
    FastAPI,
    File,
    Form,
    HTTPException,
    UploadFile,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from fastapi.responses import FileResponse

# =========================================================
# Configuration
# =========================================================

BASE_DIR = Path(__file__).resolve().parent

# Load backend/.env regardless of the terminal's current folder.
load_dotenv(BASE_DIR / ".env")

SYNCTHING_URL = os.getenv(
    "SYNCTHING_URL",
    "http://127.0.0.1:8384",
).rstrip("/")

SYNCTHING_API_KEY = os.getenv("SYNCTHING_API_KEY")

# By default, OpenUI may create folders only inside
# the current Windows user's home directory.
#
# This can later be changed inside backend/.env:
#
# OPENUI_ALLOWED_ROOT=D:\OpenUI
OPENUI_ALLOWED_ROOT = Path(
    os.getenv(
        "OPENUI_ALLOWED_ROOT",
        str(Path.home()),
    )
).expanduser().resolve()


# =========================================================
# FastAPI application
# =========================================================

app = FastAPI(
    title="OpenUI Hub API",
    version="0.0.3",
    description=(
        "A simple interface for managing Syncthing "
        "and other self-hosted open-source applications."
    ),
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================================================
# Request models
# =========================================================

class CreateFolderRequest(BaseModel):
    """Information required to create a Syncthing folder."""

    label: str = Field(
        min_length=1,
        max_length=128,
        description="The name shown to the user.",
    )

    path: str = Field(
        min_length=3,
        max_length=500,
        description="The complete local folder path.",
    )

    folder_type: Literal[
        "sendreceive",
        "sendonly",
        "receiveonly",
    ] = "sendreceive"


# =========================================================
# Shared helpers
# =========================================================

def get_syncthing_headers() -> dict[str, str]:
    """Return authentication headers for the Syncthing API."""

    if not SYNCTHING_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=(
                "Syncthing API Key is missing. "
                "Check the backend/.env file."
            ),
        )

    return {
        "X-API-Key": SYNCTHING_API_KEY,
        "Accept": "application/json",
    }


def normalize_path(value: str | Path) -> str:
    """Normalize a path for reliable Windows comparisons."""

    return os.path.normcase(
        os.path.abspath(
            os.path.expanduser(str(value))
        )
    )


def ensure_path_is_allowed(folder_path: Path) -> None:
    """
    Prevent OpenUI from creating folders outside the
    configured allowed storage directory.
    """

    allowed_root = normalize_path(OPENUI_ALLOWED_ROOT)
    requested_path = normalize_path(folder_path)

    try:
        common_path = os.path.commonpath(
            [
                allowed_root,
                requested_path,
            ]
        )
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "The selected folder is outside "
                "the allowed storage location."
            ),
        ) from error

    if common_path != allowed_root:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "For security, OpenUI can currently create "
                f"folders only inside: {OPENUI_ALLOWED_ROOT}"
            ),
        )


async def get_syncthing_folder_config(
    folder_id: str,
) -> dict[str, Any]:
    """Load one folder configuration from Syncthing."""

    clean_folder_id = folder_id.strip()

    if not clean_folder_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A folder ID is required.",
        )

    headers = get_syncthing_headers()

    try:
        async with httpx.AsyncClient(
            timeout=10.0,
        ) as client:
            response = await client.get(
                (
                    f"{SYNCTHING_URL}"
                    f"/rest/config/folders/{clean_folder_id}"
                ),
                headers=headers,
            )

            if response.status_code == 404:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="The selected folder was not found.",
                )

            response.raise_for_status()
            folder_config = response.json()

        if not isinstance(folder_config, dict):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=(
                    "Syncthing returned an invalid "
                    "folder configuration."
                ),
            )

        return folder_config

    except HTTPException:
        raise

    except httpx.HTTPStatusError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Syncthing could not load "
                "the selected folder."
            ),
        ) from error

    except httpx.RequestError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Could not connect to Syncthing. "
                "Make sure Syncthing is running."
            ),
        ) from error


# =========================================================
# OpenUI routes
# =========================================================

@app.get("/")
def home() -> dict[str, str]:
    """Return basic OpenUI server information."""

    return {
        "message": "OpenUI Backend is working",
        "version": "0.0.3",
    }


@app.get("/api/health")
def openui_health() -> dict[str, str | bool]:
    """Return the health of the OpenUI backend."""

    return {
        "healthy": True,
        "service": "openui-backend",
        "version": "0.0.3",
    }


# =========================================================
# Syncthing status
# =========================================================

@app.get("/api/syncthing/status")
async def get_syncthing_status() -> dict[str, Any]:
    """Return Syncthing status and version information."""

    headers = get_syncthing_headers()

    try:
        async with httpx.AsyncClient(
            timeout=10.0,
        ) as client:
            status_response = await client.get(
                f"{SYNCTHING_URL}/rest/system/status",
                headers=headers,
            )

            version_response = await client.get(
                f"{SYNCTHING_URL}/rest/system/version",
                headers=headers,
            )

            status_response.raise_for_status()
            version_response.raise_for_status()

            status_data = status_response.json()
            version_data = version_response.json()

        return {
            "connected": True,
            "device_id": status_data.get("myID"),
            "uptime_seconds": status_data.get("uptime", 0),
            "memory_bytes": status_data.get("sys", 0),
            "syncthing_version": version_data.get(
                "version",
                "Unknown",
            ),
            "operating_system": version_data.get(
                "os",
                "Unknown",
            ),
            "architecture": version_data.get(
                "arch",
                "Unknown",
            ),
        }

    except httpx.HTTPStatusError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Syncthing rejected the request. "
                "Check the API Key."
            ),
        ) from error

    except httpx.RequestError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Could not connect to Syncthing. "
                "Make sure Syncthing is running."
            ),
        ) from error


# =========================================================
# List Syncthing folders
# =========================================================

@app.get("/api/syncthing/folders")
async def get_syncthing_folders() -> list[dict[str, Any]]:
    """Return every folder currently configured in Syncthing."""

    headers = get_syncthing_headers()

    try:
        async with httpx.AsyncClient(
            timeout=10.0,
        ) as client:
            response = await client.get(
                f"{SYNCTHING_URL}/rest/config/folders",
                headers=headers,
            )

            response.raise_for_status()
            folders = response.json()

        if not isinstance(folders, list):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=(
                    "Syncthing returned an invalid "
                    "folders response."
                ),
            )

        return [
            {
                "id": folder.get("id"),
                "label": (
                    folder.get("label")
                    or folder.get("id")
                ),
                "path": folder.get("path"),
                "type": folder.get("type"),
                "paused": folder.get(
                    "paused",
                    False,
                ),
                "device_count": len(
                    folder.get("devices", [])
                ),
            }
            for folder in folders
            if isinstance(folder, dict)
        ]

    except HTTPException:
        raise

    except httpx.HTTPStatusError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Syncthing rejected the folders request."
            ),
        ) from error

    except httpx.RequestError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Could not connect to Syncthing. "
                "Make sure Syncthing is running."
            ),
        ) from error


# =========================================================
# Create a new Syncthing folder
# =========================================================

@app.post(
    "/api/syncthing/folders",
    status_code=status.HTTP_201_CREATED,
)
async def create_syncthing_folder(
    folder: CreateFolderRequest,
) -> dict[str, Any]:
    """
    Create a physical folder on the computer and register
    it in Syncthing.
    """

    label = folder.label.strip()
    path_text = folder.path.strip()

    if not label:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please enter a folder name.",
        )

    raw_path = Path(path_text).expanduser()

    if not raw_path.is_absolute():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Please enter a complete folder path, "
                "such as C:/Users/admin/My Folder."
            ),
        )

    folder_path = raw_path.resolve(
        strict=False,
    )

    ensure_path_is_allowed(folder_path)

    if folder_path.exists() and not folder_path.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "The selected path belongs to a file, "
                "not a folder."
            ),
        )

    headers = get_syncthing_headers()

    try:
        async with httpx.AsyncClient(
            timeout=15.0,
        ) as client:
            # Check whether the same path is already registered.
            folders_response = await client.get(
                f"{SYNCTHING_URL}/rest/config/folders",
                headers=headers,
            )

            folders_response.raise_for_status()
            existing_folders = folders_response.json()

            requested_path = normalize_path(folder_path)

            if isinstance(existing_folders, list):
                for existing_folder in existing_folders:
                    if not isinstance(existing_folder, dict):
                        continue

                    existing_path = existing_folder.get("path")

                    if not existing_path:
                        continue

                    if (
                        normalize_path(existing_path)
                        == requested_path
                    ):
                        raise HTTPException(
                            status_code=(
                                status.HTTP_409_CONFLICT
                            ),
                            detail=(
                                "This folder is already "
                                "registered in Syncthing."
                            ),
                        )

            # Load Syncthing's default folder configuration.
            defaults_response = await client.get(
                (
                    f"{SYNCTHING_URL}"
                    "/rest/config/defaults/folder"
                ),
                headers=headers,
            )

            defaults_response.raise_for_status()
            folder_config = defaults_response.json()

            if not isinstance(folder_config, dict):
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=(
                        "Syncthing returned invalid "
                        "default folder settings."
                    ),
                )

            # Create the real folder on Windows.
            folder_path.mkdir(
                parents=True,
                exist_ok=True,
            )

            folder_id = (
                f"openui-{uuid4().hex[:12]}"
            )

            folder_config.update(
                {
                    "id": folder_id,
                    "label": label,
                    "path": str(folder_path),
                    "type": folder.folder_type,
                    "paused": False,
                }
            )

            # Register the folder in Syncthing.
            create_response = await client.post(
                f"{SYNCTHING_URL}/rest/config/folders",
                headers=headers,
                json=folder_config,
            )

            create_response.raise_for_status()

        return {
            "created": True,
            "id": folder_id,
            "label": label,
            "path": str(folder_path),
            "type": folder.folder_type,
            "paused": False,
            "message": (
                "The sync folder was created successfully."
            ),
        }

    except HTTPException:
        raise

    except PermissionError as error:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "OpenUI does not have permission "
                "to create this folder."
            ),
        ) from error

    except OSError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Windows could not create the folder. "
                "Check the path and available disk space."
            ),
        ) from error

    except httpx.HTTPStatusError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Syncthing could not add the folder. "
                "Check whether its path is already registered."
            ),
        ) from error

    except httpx.RequestError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Could not connect to Syncthing. "
                "Make sure Syncthing is running."
            ),
        ) from error


# =========================================================
# Open a Syncthing folder in Windows Explorer
# =========================================================

@app.post(
    "/api/syncthing/folders/{folder_id}/open",
)
async def open_syncthing_folder(
    folder_id: str,
) -> dict[str, Any]:
    """Open a configured Syncthing folder in Explorer."""

    folder_config = await get_syncthing_folder_config(
        folder_id
    )

    configured_path = folder_config.get("path")

    if not configured_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "The selected folder does not have "
                "a valid local path."
            ),
        )

    folder_path = Path(
        str(configured_path)
    ).expanduser().resolve(
        strict=False
    )

    if not folder_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                "The folder does not exist "
                "on this computer."
            ),
        )

    if not folder_path.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "The configured path is not a folder."
            ),
        )

    if os.name != "nt":
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail=(
                "Opening folders is currently "
                "supported only on Windows."
            ),
        )

    try:
        subprocess.Popen(
            [
                "explorer.exe",
                str(folder_path),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        return {
            "opened": True,
            "folder_id": folder_id,
            "path": str(folder_path),
            "message": (
                "The folder was opened successfully."
            ),
        }

    except OSError as error:
        raise HTTPException(
            status_code=(
                status.HTTP_500_INTERNAL_SERVER_ERROR
            ),
            detail=(
                "Windows could not open the folder."
            ),
        ) from error


# =========================================================
# Rescan a Syncthing folder
# =========================================================

@app.post(
    "/api/syncthing/folders/{folder_id}/scan",
)
async def scan_syncthing_folder(
    folder_id: str,
) -> dict[str, Any]:
    """Ask Syncthing to scan one folder immediately."""

    # Verify that the folder exists before starting the scan.
    await get_syncthing_folder_config(folder_id)

    headers = get_syncthing_headers()

    try:
        async with httpx.AsyncClient(
            timeout=30.0,
        ) as client:
            response = await client.post(
                f"{SYNCTHING_URL}/rest/db/scan",
                headers=headers,
                params={
                    "folder": folder_id,
                },
            )

            response.raise_for_status()

        return {
            "scanning": True,
            "folder_id": folder_id,
            "message": (
                "Syncthing started scanning the folder."
            ),
        }

    except httpx.HTTPStatusError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Syncthing could not scan the folder."
            ),
        ) from error

    except httpx.RequestError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Could not connect to Syncthing. "
                "Make sure Syncthing is running."
            ),
        ) from error

    # =========================================================
# Folder controls: pause, resume, rename and remove
# =========================================================

class UpdateFolderPausedRequest(BaseModel):
    """Request used to pause or resume a folder."""

    paused: bool


class RenameFolderRequest(BaseModel):
    """Request used to update the displayed folder name."""

    label: str = Field(
        min_length=1,
        max_length=128,
    )


async def patch_syncthing_folder(
    folder_id: str,
    changes: dict[str, Any],
) -> None:
    """Apply partial configuration changes to one folder."""

    await get_syncthing_folder_config(folder_id)

    headers = get_syncthing_headers()

    try:
        async with httpx.AsyncClient(
            timeout=15.0,
        ) as client:
            response = await client.patch(
                (
                    f"{SYNCTHING_URL}"
                    f"/rest/config/folders/{folder_id}"
                ),
                headers=headers,
                json=changes,
            )

            response.raise_for_status()

    except httpx.HTTPStatusError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Syncthing could not update "
                "the selected folder."
            ),
        ) from error

    except httpx.RequestError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Could not connect to Syncthing. "
                "Make sure Syncthing is running."
            ),
        ) from error


@app.patch(
    "/api/syncthing/folders/{folder_id}/paused",
)
async def update_syncthing_folder_paused(
    folder_id: str,
    request: UpdateFolderPausedRequest,
) -> dict[str, Any]:
    """Pause or resume a Syncthing folder."""

    await patch_syncthing_folder(
        folder_id,
        {
            "paused": request.paused,
        },
    )

    return {
        "updated": True,
        "folder_id": folder_id,
        "paused": request.paused,
        "message": (
            "The folder was paused successfully."
            if request.paused
            else "The folder was resumed successfully."
        ),
    }


@app.patch(
    "/api/syncthing/folders/{folder_id}/rename",
)
async def rename_syncthing_folder(
    folder_id: str,
    request: RenameFolderRequest,
) -> dict[str, Any]:
    """Change the displayed label of a Syncthing folder."""

    clean_label = request.label.strip()

    if not clean_label:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please enter a folder name.",
        )

    await patch_syncthing_folder(
        folder_id,
        {
            "label": clean_label,
        },
    )

    return {
        "updated": True,
        "folder_id": folder_id,
        "label": clean_label,
        "message": (
            "The folder was renamed successfully."
        ),
    }


@app.delete(
    "/api/syncthing/folders/{folder_id}",
)
async def remove_syncthing_folder(
    folder_id: str,
) -> dict[str, Any]:
    """
    Remove a folder from Syncthing without deleting
    the physical files stored on the computer.
    """

    folder_config = await get_syncthing_folder_config(
        folder_id
    )

    folder_label = (
        folder_config.get("label")
        or folder_config.get("id")
        or folder_id
    )

    folder_path = folder_config.get("path")

    headers = get_syncthing_headers()

    try:
        async with httpx.AsyncClient(
            timeout=15.0,
        ) as client:
            response = await client.delete(
                (
                    f"{SYNCTHING_URL}"
                    f"/rest/config/folders/{folder_id}"
                ),
                headers=headers,
            )

            response.raise_for_status()

        return {
            "removed": True,
            "folder_id": folder_id,
            "label": folder_label,
            "path": folder_path,
            "files_deleted": False,
            "message": (
                "The folder was removed from Syncthing. "
                "The files remain on this computer."
            ),
        }

    except httpx.HTTPStatusError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Syncthing could not remove "
                "the selected folder."
            ),
        ) from error

    except httpx.RequestError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Could not connect to Syncthing. "
                "Make sure Syncthing is running."
            ),
        ) from error

    # =========================================================
# File browser
# =========================================================

def resolve_folder_browser_path(
    folder_root: Path,
    relative_path: str,
) -> Path:
    """
    Resolve a path inside a Syncthing folder while blocking
    absolute paths and directory traversal attempts.
    """

    root_path = folder_root.expanduser().resolve(
        strict=False
    )

    clean_relative_path = (
        relative_path
        .strip()
        .replace("\\", "/")
    )

    relative = Path(clean_relative_path)

    if relative.is_absolute():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "The browser path must be relative "
                "to the sync folder."
            ),
        )

    if ".." in relative.parts:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Access outside the sync folder "
                "is not allowed."
            ),
        )

    target_path = (
        root_path / relative
    ).resolve(
        strict=False
    )

    try:
        common_path = os.path.commonpath(
            [
                normalize_path(root_path),
                normalize_path(target_path),
            ]
        )
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Access outside the sync folder "
                "is not allowed."
            ),
        ) from error

    if common_path != normalize_path(root_path):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Access outside the sync folder "
                "is not allowed."
            ),
        )

    return target_path


def build_folder_breadcrumbs(
    folder_label: str,
    relative_path: Path,
) -> list[dict[str, str]]:
    """Create navigation breadcrumbs for the file browser."""

    breadcrumbs = [
        {
            "label": folder_label,
            "path": "",
        }
    ]

    current_parts: list[str] = []

    for part in relative_path.parts:
        if part in {"", "."}:
            continue

        current_parts.append(part)

        breadcrumbs.append(
            {
                "label": part,
                "path": "/".join(current_parts),
            }
        )

    return breadcrumbs


@app.get(
    "/api/syncthing/folders/{folder_id}/files",
)
async def list_syncthing_folder_files(
    folder_id: str,
    path: str = "",
) -> dict[str, Any]:
    """
    List the files and subfolders inside a configured
    Syncthing folder.
    """

    folder_config = await get_syncthing_folder_config(
        folder_id
    )

    configured_path = folder_config.get("path")

    if not configured_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "The selected folder does not have "
                "a valid local path."
            ),
        )

    folder_root = Path(
        str(configured_path)
    ).expanduser().resolve(
        strict=False
    )

    if not folder_root.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                "The sync folder does not exist "
                "on this computer."
            ),
        )

    if not folder_root.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "The configured sync path "
                "is not a folder."
            ),
        )

    target_path = resolve_folder_browser_path(
        folder_root,
        path,
    )

    if not target_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                "The requested folder does not exist."
            ),
        )

    if not target_path.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "The requested path is not a folder."
            ),
        )

    entries: list[dict[str, Any]] = []

    try:
        for entry in target_path.iterdir():
            # Hide Syncthing's internal marker folder.
            if entry.name == ".stfolder":
                continue

            try:
                file_information = entry.stat()
            except OSError:
                # Skip an item that Windows cannot currently read.
                continue

            is_folder = entry.is_dir()

            entry_relative_path = entry.relative_to(
                folder_root
            ).as_posix()

            entries.append(
                {
                    "name": entry.name,
                    "path": entry_relative_path,
                    "type": (
                        "folder"
                        if is_folder
                        else "file"
                    ),
                    "is_folder": is_folder,
                    "size_bytes": (
                        None
                        if is_folder
                        else file_information.st_size
                    ),
                    "extension": (
                        ""
                        if is_folder
                        else entry.suffix.lower()
                    ),
                    "modified_at": datetime.fromtimestamp(
                        file_information.st_mtime,
                        tz=timezone.utc,
                    ).isoformat(),
                }
            )

    except PermissionError as error:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "OpenUI does not have permission "
                "to read this folder."
            ),
        ) from error

    except OSError as error:
        raise HTTPException(
            status_code=(
                status.HTTP_500_INTERNAL_SERVER_ERROR
            ),
            detail=(
                "Windows could not read "
                "the selected folder."
            ),
        ) from error

    # Show folders first, then files alphabetically.
    entries.sort(
        key=lambda item: (
            not item["is_folder"],
            item["name"].lower(),
        )
    )

    current_relative_path = target_path.relative_to(
        folder_root
    )

    current_path_text = (
        ""
        if str(current_relative_path) == "."
        else current_relative_path.as_posix()
    )

    folder_label = str(
        folder_config.get("label")
        or folder_config.get("id")
        or folder_id
    )

    return {
        "folder": {
            "id": folder_id,
            "label": folder_label,
            "root_path": str(folder_root),
        },
        "current_path": current_path_text,
        "breadcrumbs": build_folder_breadcrumbs(
            folder_label,
            current_relative_path,
        ),
        "entries": entries,
        "entry_count": len(entries),
    }

# =========================================================
# File preview and download
# =========================================================

async def resolve_syncthing_file(
    folder_id: str,
    relative_path: str,
) -> Path:
    """
    Resolve one file inside a configured Syncthing folder.

    The existing browser path protection prevents access
    outside the selected sync folder.
    """

    if not relative_path.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A file path is required.",
        )

    folder_config = await get_syncthing_folder_config(
        folder_id
    )

    configured_path = folder_config.get("path")

    if not configured_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "The selected folder does not have "
                "a valid local path."
            ),
        )

    folder_root = Path(
        str(configured_path)
    ).expanduser().resolve(
        strict=False
    )

    if not folder_root.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                "The sync folder does not exist "
                "on this computer."
            ),
        )

    if not folder_root.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "The configured sync path "
                "is not a folder."
            ),
        )

    target_file = resolve_folder_browser_path(
        folder_root,
        relative_path,
    )

    if not target_file.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="The requested file does not exist.",
        )

    if not target_file.is_file():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "The requested path does not belong "
                "to a file."
            ),
        )

    try:
        target_file.stat()
    except PermissionError as error:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "OpenUI does not have permission "
                "to read this file."
            ),
        ) from error
    except OSError as error:
        raise HTTPException(
            status_code=(
                status.HTTP_500_INTERNAL_SERVER_ERROR
            ),
            detail="Windows could not read this file.",
        ) from error

    return target_file


@app.get(
    "/api/syncthing/folders/{folder_id}/files/content",
    response_class=FileResponse,
)
async def preview_syncthing_file(
    folder_id: str,
    path: str,
) -> FileResponse:
    """
    Return a file inline so supported types can be previewed
    by the browser, including images and PDF documents.
    """

    target_file = await resolve_syncthing_file(
        folder_id,
        path,
    )

    media_type, _ = mimetypes.guess_type(
        target_file.name
    )

    return FileResponse(
        path=target_file,
        media_type=(
            media_type
            or "application/octet-stream"
        ),
    )


@app.get(
    "/api/syncthing/folders/{folder_id}/files/download",
    response_class=FileResponse,
)
async def download_syncthing_file(
    folder_id: str,
    path: str,
) -> FileResponse:
    """Download one file from the selected sync folder."""

    target_file = await resolve_syncthing_file(
        folder_id,
        path,
    )

    media_type, _ = mimetypes.guess_type(
        target_file.name
    )

    return FileResponse(
        path=target_file,
        media_type=(
            media_type
            or "application/octet-stream"
        ),
        filename=target_file.name,
    )

# =========================================================
# Upload files and create folders inside sync folders
# =========================================================

UPLOAD_CHUNK_SIZE = 1024 * 1024
OPENUI_MAX_UPLOAD_BYTES = 512 * 1024 * 1024


class CreateInnerFolderRequest(BaseModel):
    """Create a subfolder inside a Syncthing folder."""

    parent_path: str = Field(
        default="",
        max_length=1000,
    )

    name: str = Field(
        min_length=1,
        max_length=255,
    )


def validate_item_name(
    value: str,
    item_description: str,
) -> str:
    """
    Validate a file or directory name before using it
    on the local filesystem.
    """

    clean_name = value.strip()

    if not clean_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Please enter a valid {item_description} name.",
        )

    if clean_name in {".", ".."}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"The selected {item_description} name is not allowed.",
        )

    if "/" in clean_name or "\\" in clean_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"The {item_description} name cannot contain "
                "path separators."
            ),
        )

    if clean_name.lower() == ".stfolder":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "The name .stfolder is reserved by Syncthing."
            ),
        )

    if clean_name.rstrip(" .") != clean_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"The {item_description} name cannot end "
                "with a space or period."
            ),
        )

    windows_reserved_names = {
        "CON",
        "PRN",
        "AUX",
        "NUL",
        "COM1",
        "COM2",
        "COM3",
        "COM4",
        "COM5",
        "COM6",
        "COM7",
        "COM8",
        "COM9",
        "LPT1",
        "LPT2",
        "LPT3",
        "LPT4",
        "LPT5",
        "LPT6",
        "LPT7",
        "LPT8",
        "LPT9",
    }

    first_name_part = clean_name.split(".", 1)[0].upper()

    if first_name_part in windows_reserved_names:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"The selected {item_description} name "
                "is reserved by Windows."
            ),
        )

    return clean_name


async def resolve_syncthing_directory(
    folder_id: str,
    relative_path: str = "",
) -> tuple[Path, Path]:
    """
    Return the Syncthing folder root and one safe directory
    inside it.
    """

    folder_config = await get_syncthing_folder_config(
        folder_id
    )

    configured_path = folder_config.get("path")

    if not configured_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "The selected sync folder does not have "
                "a valid local path."
            ),
        )

    folder_root = Path(
        str(configured_path)
    ).expanduser().resolve(
        strict=False
    )

    if not folder_root.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                "The sync folder does not exist "
                "on this computer."
            ),
        )

    if not folder_root.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "The configured sync path is not a directory."
            ),
        )

    target_directory = resolve_folder_browser_path(
        folder_root,
        relative_path,
    )

    if not target_directory.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                "The selected destination folder does not exist."
            ),
        )

    if not target_directory.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "The selected destination is not a folder."
            ),
        )

    return folder_root, target_directory


@app.post(
    "/api/syncthing/folders/{folder_id}/files/folders",
    status_code=status.HTTP_201_CREATED,
)
async def create_inner_folder(
    folder_id: str,
    request: CreateInnerFolderRequest,
) -> dict[str, Any]:
    """Create a directory inside a sync folder."""

    folder_root, parent_directory = (
        await resolve_syncthing_directory(
            folder_id,
            request.parent_path,
        )
    )

    clean_name = validate_item_name(
        request.name,
        "folder",
    )

    new_folder = parent_directory / clean_name

    if new_folder.exists():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "A file or folder with this name already exists."
            ),
        )

    try:
        new_folder.mkdir()
        folder_information = new_folder.stat()

    except PermissionError as error:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "OpenUI does not have permission "
                "to create this folder."
            ),
        ) from error

    except OSError as error:
        raise HTTPException(
            status_code=(
                status.HTTP_500_INTERNAL_SERVER_ERROR
            ),
            detail=(
                "Windows could not create the folder."
            ),
        ) from error

    relative_path = new_folder.relative_to(
        folder_root
    ).as_posix()

    return {
        "created": True,
        "entry": {
            "name": new_folder.name,
            "path": relative_path,
            "type": "folder",
            "is_folder": True,
            "size_bytes": None,
            "extension": "",
            "modified_at": datetime.fromtimestamp(
                folder_information.st_mtime,
                tz=timezone.utc,
            ).isoformat(),
        },
        "message": (
            "The folder was created successfully."
        ),
    }


@app.post(
    "/api/syncthing/folders/{folder_id}/files/upload",
    status_code=status.HTTP_201_CREATED,
)
async def upload_syncthing_file(
    folder_id: str,
    path: str = Form(default=""),
    overwrite: bool = Form(default=False),
    file: UploadFile = File(...),
) -> dict[str, Any]:
    """Upload one file into a selected sync directory."""

    folder_root, target_directory = (
        await resolve_syncthing_directory(
            folder_id,
            path,
        )
    )

    original_filename = (
        file.filename
        or ""
    )

    safe_filename = Path(
        original_filename.replace("\\", "/")
    ).name

    safe_filename = validate_item_name(
        safe_filename,
        "file",
    )

    target_file = target_directory / safe_filename

    if target_file.exists() and target_file.is_dir():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "A folder with this name already exists."
            ),
        )

    if target_file.exists() and not overwrite:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "A file with this name already exists. "
                "Enable overwrite to replace it."
            ),
        )

    temporary_file = target_directory / (
        f".openui-upload-{uuid4().hex}.tmp"
    )

    uploaded_size = 0

    try:
        with temporary_file.open("wb") as output:
            while True:
                chunk = await file.read(
                    UPLOAD_CHUNK_SIZE
                )

                if not chunk:
                    break

                uploaded_size += len(chunk)

                if (
                    uploaded_size
                    > OPENUI_MAX_UPLOAD_BYTES
                ):
                    raise HTTPException(
                        status_code=(
                            status.HTTP_413_CONTENT_TOO_LARGE
                        ),
                        detail=(
                            "The uploaded file exceeds "
                            "the 512 MB limit."
                        ),
                    )

                output.write(chunk)

        os.replace(
            temporary_file,
            target_file,
        )

        file_information = target_file.stat()

    except HTTPException:
        if temporary_file.exists():
            temporary_file.unlink(
                missing_ok=True
            )

        raise

    except PermissionError as error:
        if temporary_file.exists():
            temporary_file.unlink(
                missing_ok=True
            )

        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "OpenUI does not have permission "
                "to save this file."
            ),
        ) from error

    except OSError as error:
        if temporary_file.exists():
            temporary_file.unlink(
                missing_ok=True
            )

        raise HTTPException(
            status_code=(
                status.HTTP_500_INTERNAL_SERVER_ERROR
            ),
            detail=(
                "Windows could not save the uploaded file."
            ),
        ) from error

    finally:
        await file.close()

    relative_file_path = target_file.relative_to(
        folder_root
    ).as_posix()

    return {
        "uploaded": True,
        "entry": {
            "name": target_file.name,
            "path": relative_file_path,
            "type": "file",
            "is_folder": False,
            "size_bytes": file_information.st_size,
            "extension": target_file.suffix.lower(),
            "modified_at": datetime.fromtimestamp(
                file_information.st_mtime,
                tz=timezone.utc,
            ).isoformat(),
        },
        "message": (
            "The file was uploaded successfully."
        ),
    }