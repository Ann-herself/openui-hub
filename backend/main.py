import os
import subprocess
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


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