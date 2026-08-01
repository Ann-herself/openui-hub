import asyncio
import mimetypes
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

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
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

try:
    from backend.version import APP_VERSION
except ImportError:
    try:
        from version import APP_VERSION
    except ImportError:
        APP_VERSION = os.getenv("OPENUI_APP_VERSION", "1.0.3")

APP_AUTHOR = "Ann Miqdad"
APP_REPOSITORY = "https://github.com/Ann-herself/openui-hub"

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
    version=APP_VERSION,
    description=(
        "The local API for OpenUI Hub, a professional interface "
        "for managing Syncthing files, folders, and devices. "
        "Designed and developed by Ann Miqdad."
    ),
    contact={
        "name": APP_AUTHOR,
        "url": APP_REPOSITORY,
    },
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
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


def safe_int(value: Any, default: int = 0) -> int:
    """Convert Syncthing numeric values without crashing the API."""

    if value is None or value == "":
        return default
    try:
        return int(value)
    except (TypeError, ValueError, OverflowError):
        return default


def browser_entry_payload(
    folder_root: Path,
    entry_path: Path,
    information: os.stat_result | None = None,
) -> dict[str, Any]:
    """Return one frontend-compatible file browser entry."""

    file_information = information or entry_path.stat()
    is_folder = entry_path.is_dir()
    return {
        "name": entry_path.name,
        "path": entry_path.relative_to(folder_root).as_posix(),
        "type": "folder" if is_folder else "file",
        "is_folder": is_folder,
        "size_bytes": None if is_folder else file_information.st_size,
        "extension": "" if is_folder else entry_path.suffix.lower(),
        "modified_at": datetime.fromtimestamp(
            file_information.st_mtime,
            tz=timezone.utc,
        ).isoformat(),
    }


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

@app.get("/api/info")
def home() -> dict[str, str]:
    """Return public OpenUI Hub application information."""

    return {
        "message": "OpenUI Hub Backend is working",
        "version": APP_VERSION,
        "author": APP_AUTHOR,
        "repository": APP_REPOSITORY,
    }



@app.get("/api/health")
def openui_health() -> dict[str, str | bool]:
    """Return the health of the OpenUI backend."""

    return {
        "healthy": True,
        "service": "openui-backend",
        "version": APP_VERSION,
    }


# =========================================================
# Syncthing status
# =========================================================

@app.get("/api/syncthing/status")
async def get_syncthing_status() -> dict[str, Any]:
    """Return validated Syncthing status and version information."""

    headers = get_syncthing_headers()

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            status_response, version_response = await asyncio.gather(
                client.get(
                    f"{SYNCTHING_URL}/rest/system/status",
                    headers=headers,
                ),
                client.get(
                    f"{SYNCTHING_URL}/rest/system/version",
                    headers=headers,
                ),
            )

        status_response.raise_for_status()
        version_response.raise_for_status()

        status_data = status_response.json()
        version_data = version_response.json()

        if not isinstance(status_data, dict) or not isinstance(version_data, dict):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Syncthing returned an invalid status response.",
            )

        return {
            "connected": True,
            "device_id": str(status_data.get("myID") or ""),
            "uptime_seconds": safe_int(status_data.get("uptime")),
            "memory_bytes": safe_int(status_data.get("sys")),
            "syncthing_version": str(version_data.get("version") or "Unknown"),
            "operating_system": str(version_data.get("os") or "Unknown"),
            "architecture": str(version_data.get("arch") or "Unknown"),
        }

    except HTTPException:
        raise
    except httpx.HTTPStatusError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Syncthing rejected the status request. Check the API Key.",
        ) from error
    except httpx.RequestError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not connect to Syncthing. Make sure Syncthing is running.",
        ) from error
    except (TypeError, ValueError) as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Syncthing returned status data in an unexpected format.",
        ) from error



# =========================================================
# Syncthing activity
# =========================================================

@app.get("/api/syncthing/activity")
async def get_syncthing_activity() -> dict[str, Any]:
    """Return recent Syncthing events and per-folder errors."""

    headers = get_syncthing_headers()

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            events_response, disk_events_response, folders_response = (
                await asyncio.gather(
                    client.get(
                        f"{SYNCTHING_URL}/rest/events",
                        params={"since": 0, "limit": 100, "timeout": 1},
                        headers=headers,
                    ),
                    client.get(
                        f"{SYNCTHING_URL}/rest/events/disk",
                        params={"since": 0, "limit": 100, "timeout": 1},
                        headers=headers,
                    ),
                    client.get(
                        f"{SYNCTHING_URL}/rest/config/folders",
                        headers=headers,
                    ),
                )
            )

            events_response.raise_for_status()
            disk_events_response.raise_for_status()
            folders_response.raise_for_status()

            event_sources = [events_response.json(), disk_events_response.json()]
            folders_data = folders_response.json()

            merged_events: dict[int, dict[str, Any]] = {}
            for source in event_sources:
                if not isinstance(source, list):
                    continue
                for raw_event in source:
                    if not isinstance(raw_event, dict):
                        continue
                    event_id = safe_int(raw_event.get("id"), default=-1)
                    if event_id < 0:
                        continue
                    raw_data = raw_event.get("data")
                    merged_events[event_id] = {
                        "id": event_id,
                        "type": str(raw_event.get("type") or "Event"),
                        "time": str(raw_event.get("time") or ""),
                        "data": raw_data if isinstance(raw_data, dict) else {},
                    }

            events = sorted(
                merged_events.values(),
                key=lambda item: item["id"],
                reverse=True,
            )[:100]

            folder_ids = [
                str(folder.get("id") or "").strip()
                for folder in folders_data
                if isinstance(folder, dict) and str(folder.get("id") or "").strip()
            ] if isinstance(folders_data, list) else []

            error_responses = await asyncio.gather(
                *(
                    client.get(
                        f"{SYNCTHING_URL}/rest/folder/errors",
                        params={"folder": folder_id, "page": 1, "perpage": 100},
                        headers=headers,
                    )
                    for folder_id in folder_ids
                ),
                return_exceptions=True,
            )

        errors: dict[str, list[dict[str, str]]] = {}
        for folder_id, response in zip(folder_ids, error_responses):
            if isinstance(response, Exception) or not isinstance(response, httpx.Response):
                continue
            if response.status_code >= 400:
                continue
            try:
                payload = response.json()
            except ValueError:
                continue
            raw_errors = payload.get("errors", []) if isinstance(payload, dict) else []
            normalized_errors: list[dict[str, str]] = []
            if isinstance(raw_errors, list):
                for item in raw_errors:
                    if not isinstance(item, dict):
                        continue
                    error_text = str(item.get("error") or "Unknown folder error").strip()
                    error_path = str(item.get("path") or "").strip()
                    normalized_errors.append({
                        "error": f"{error_path}: {error_text}" if error_path else error_text,
                        "time": str(item.get("time") or ""),
                    })
            if normalized_errors:
                errors[folder_id] = normalized_errors

        return {"events": events, "errors": errors}

    except HTTPException:
        raise
    except httpx.HTTPStatusError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Syncthing rejected the activity request. Check the API Key.",
        ) from error
    except httpx.RequestError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not connect to Syncthing. Make sure Syncthing is running.",
        ) from error
    except (TypeError, ValueError) as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Syncthing returned activity data in an unexpected format.",
        ) from error



# =========================================================
# OpenUI settings
# =========================================================

@app.get("/api/settings")
async def get_app_settings() -> dict[str, Any]:
    """Return the application, author, and Syncthing overview."""

    headers = get_syncthing_headers()

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            (
                status_response,
                version_response,
                folders_response,
                devices_response,
            ) = await asyncio.gather(
                client.get(
                    f"{SYNCTHING_URL}/rest/system/status",
                    headers=headers,
                ),
                client.get(
                    f"{SYNCTHING_URL}/rest/system/version",
                    headers=headers,
                ),
                client.get(
                    f"{SYNCTHING_URL}/rest/config/folders",
                    headers=headers,
                ),
                client.get(
                    f"{SYNCTHING_URL}/rest/config/devices",
                    headers=headers,
                ),
            )

        for response in (
            status_response,
            version_response,
            folders_response,
            devices_response,
        ):
            response.raise_for_status()

        status_data = status_response.json()
        version_data = version_response.json()
        folders_data = folders_response.json()
        devices_data = devices_response.json()

        if not isinstance(status_data, dict) or not isinstance(version_data, dict):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Syncthing returned invalid system information.",
            )
        if not isinstance(folders_data, list) or not isinstance(devices_data, list):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Syncthing returned invalid configuration information.",
            )

        local_device_id = str(status_data.get("myID") or "").strip()
        remote_devices_count = sum(
            1
            for device in devices_data
            if isinstance(device, dict)
            and str(device.get("deviceID") or "").strip()
            and str(device.get("deviceID") or "").strip() != local_device_id
        )

        return {
            "app_version": APP_VERSION,
            "author": APP_AUTHOR,
            "repository": APP_REPOSITORY,
            "syncthing_url": SYNCTHING_URL,
            "allowed_root": str(OPENUI_ALLOWED_ROOT),
            "syncthing": {
                "version": str(version_data.get("version") or "Unknown"),
                "operating_system": str(version_data.get("os") or "Unknown"),
                "architecture": str(version_data.get("arch") or "Unknown"),
                "device_id": local_device_id,
            },
            "folders_count": len(folders_data),
            "devices_count": remote_devices_count,
        }

    except HTTPException:
        raise
    except httpx.HTTPStatusError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Syncthing rejected the settings request. Check the API Key.",
        ) from error
    except httpx.RequestError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not connect to Syncthing. Make sure Syncthing is running.",
        ) from error
    except (TypeError, ValueError) as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Syncthing returned settings data in an unexpected format.",
        ) from error



# =========================================================
# List Syncthing folders
# =========================================================

@app.get("/api/syncthing/folders")
async def get_syncthing_folders() -> list[dict[str, Any]]:
    """Return configured folders with normalized remote-device counts."""

    headers = get_syncthing_headers()

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            folders_response, status_response = await asyncio.gather(
                client.get(
                    f"{SYNCTHING_URL}/rest/config/folders",
                    headers=headers,
                ),
                client.get(
                    f"{SYNCTHING_URL}/rest/system/status",
                    headers=headers,
                ),
            )

        folders_response.raise_for_status()
        status_response.raise_for_status()
        folders = folders_response.json()
        status_data = status_response.json()

        if not isinstance(folders, list) or not isinstance(status_data, dict):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Syncthing returned an invalid folders response.",
            )

        local_device_id = str(status_data.get("myID") or "").strip()
        normalized: list[dict[str, Any]] = []

        for folder in folders:
            if not isinstance(folder, dict):
                continue
            folder_id = str(folder.get("id") or "").strip()
            if not folder_id:
                continue
            raw_devices = folder.get("devices", [])
            remote_device_ids = {
                str(device.get("deviceID") or "").strip()
                for device in raw_devices
                if isinstance(device, dict)
                and str(device.get("deviceID") or "").strip()
                and str(device.get("deviceID") or "").strip() != local_device_id
            } if isinstance(raw_devices, list) else set()
            normalized.append({
                "id": folder_id,
                "label": str(folder.get("label") or folder_id),
                "path": str(folder.get("path") or ""),
                "type": str(folder.get("type") or "sendreceive"),
                "paused": bool(folder.get("paused", False)),
                "device_count": len(remote_device_ids),
            })

        normalized.sort(key=lambda item: item["label"].casefold())
        return normalized

    except HTTPException:
        raise
    except httpx.HTTPStatusError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Syncthing rejected the folders request.",
        ) from error
    except httpx.RequestError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not connect to Syncthing. Make sure Syncthing is running.",
        ) from error
    except (TypeError, ValueError) as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Syncthing returned folder data in an unexpected format.",
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


def validate_item_name(value: str, item_description: str) -> str:
    """Validate a Windows-compatible file or directory name."""

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

    if clean_name.rstrip(" .") != clean_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"The {item_description} name cannot end with a space or period.",
        )

    invalid_characters = set('<>:"/\\|?*')
    if any(character in invalid_characters or ord(character) < 32 for character in clean_name):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"The {item_description} name contains characters Windows does not allow.",
        )

    if clean_name.casefold() in {".stfolder", ".stignore", ".stversions"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This name is reserved by Syncthing.",
        )

    windows_reserved_names = {
        "CON", "PRN", "AUX", "NUL",
        *(f"COM{number}" for number in range(1, 10)),
        *(f"LPT{number}" for number in range(1, 10)),
    }
    first_name_part = clean_name.split(".", 1)[0].upper()
    if first_name_part in windows_reserved_names:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"The selected {item_description} name is reserved by Windows.",
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

# =========================================================
# Rename and delete files or folders inside sync folders
# =========================================================


class RenameBrowserEntryRequest(BaseModel):
    """Rename a file or folder inside a Syncthing directory."""

    path: str = Field(
        min_length=1,
        max_length=2000,
    )

    new_name: str = Field(
        min_length=1,
        max_length=255,
    )


async def resolve_syncthing_item_path(
    folder_id: str,
    relative_path: str,
) -> tuple[Path, Path]:
    """
    Resolve one existing file or folder safely inside a
    configured Syncthing folder.
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

    clean_relative_path = (
        relative_path
        .strip()
        .replace("\\", "/")
    )

    if (
        not clean_relative_path
        or clean_relative_path in {".", "/"}
        or clean_relative_path.startswith("/")
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Select a file or folder inside "
                "the sync folder."
            ),
        )

    raw_parts = clean_relative_path.split("/")

    path_parts = [
        part
        for part in raw_parts
        if part
    ]

    if not path_parts:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The selected path is not valid.",
        )

    if any(
        part in {".", ".."} or ":" in part
        for part in path_parts
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "The selected path contains "
                "invalid components."
            ),
        )

    reserved_syncthing_items = {
        ".stfolder",
        ".stignore",
        ".stversions",
    }

    if any(
        part.casefold() in reserved_syncthing_items
        for part in path_parts
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "This Syncthing system item "
                "cannot be modified."
            ),
        )

    candidate_path = folder_root.joinpath(
        *path_parts
    )

    if candidate_path.is_symlink():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Symbolic links cannot be managed "
                "through OpenUI."
            ),
        )

    target_path = candidate_path.resolve(
        strict=False
    )

    try:
        target_path.relative_to(folder_root)

    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "The selected item is outside "
                "the sync folder."
            ),
        ) from error

    if not target_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                "The selected file or folder "
                "does not exist."
            ),
        )

    return folder_root, target_path


@app.patch("/api/syncthing/folders/{folder_id}/files/rename")
async def rename_syncthing_browser_entry(
    folder_id: str,
    request: RenameBrowserEntryRequest,
) -> dict[str, Any]:
    """Rename a file or folder safely inside a sync folder."""

    folder_root, source_path = await resolve_syncthing_item_path(
        folder_id,
        request.path,
    )
    clean_name = validate_item_name(request.new_name, "file or folder")

    if clean_name == source_path.name:
        source_information = source_path.stat()
        return {
            "renamed": False,
            "entry": browser_entry_payload(folder_root, source_path, source_information),
            "message": "The item already has this name.",
        }

    target_path = source_path.parent / clean_name
    try:
        target_path.resolve(strict=False).relative_to(folder_root)
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The new path would be outside the sync folder.",
        ) from error

    case_only_rename = source_path.name.casefold() == clean_name.casefold()
    if target_path.exists() and not case_only_rename:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A file or folder with this name already exists.",
        )

    temporary_path: Path | None = None
    try:
        if case_only_rename:
            temporary_path = source_path.parent / f".openui-rename-{uuid4().hex}.tmp"
            source_path.rename(temporary_path)
            temporary_path.rename(target_path)
        else:
            source_path.rename(target_path)
        renamed_information = target_path.stat()
    except PermissionError as error:
        if temporary_path and temporary_path.exists() and not source_path.exists():
            try:
                temporary_path.rename(source_path)
            except OSError:
                pass
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="OpenUI Hub does not have permission to rename this item.",
        ) from error
    except OSError as error:
        if temporary_path and temporary_path.exists() and not source_path.exists():
            try:
                temporary_path.rename(source_path)
            except OSError:
                pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Windows could not rename the selected item.",
        ) from error

    return {
        "renamed": True,
        "entry": browser_entry_payload(folder_root, target_path, renamed_information),
        "message": "The item was renamed successfully.",
    }



@app.delete(
    "/api/syncthing/folders/{folder_id}/files",
)
async def delete_syncthing_browser_entry(
    folder_id: str,
    path: str,
) -> dict[str, Any]:
    """
    Permanently delete one file or folder from
    the selected Syncthing directory.
    """

    folder_root, target_path = (
        await resolve_syncthing_item_path(
            folder_id,
            path,
        )
    )

    relative_path = target_path.relative_to(
        folder_root
    ).as_posix()

    item_name = target_path.name

    item_type = (
        "folder"
        if target_path.is_dir()
        else "file"
    )

    try:
        if target_path.is_dir():
            shutil.rmtree(target_path)

        else:
            target_path.unlink()

    except PermissionError as error:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "OpenUI does not have permission "
                "to delete this item."
            ),
        ) from error

    except OSError as error:
        raise HTTPException(
            status_code=(
                status.HTTP_500_INTERNAL_SERVER_ERROR
            ),
            detail=(
                "Windows could not delete "
                "the selected item."
            ),
        ) from error

    return {
        "deleted": True,
        "name": item_name,
        "path": relative_path,
        "type": item_type,
        "message": (
            f"{item_name} was deleted permanently."
        ),
    }

# =========================================================
# Syncthing devices
# =========================================================


@app.get("/api/syncthing/devices")
async def get_syncthing_devices() -> list[dict[str, Any]]:
    """
    Return configured remote Syncthing devices together
    with their current connection information.
    """

    headers = get_syncthing_headers()

    try:
        async with httpx.AsyncClient(
            timeout=15.0,
        ) as client:
            (
                devices_response,
                connections_response,
                local_status_response,
            ) = await asyncio.gather(
                client.get(
                    f"{SYNCTHING_URL}/rest/config/devices",
                    headers=headers,
                ),
                client.get(
                    f"{SYNCTHING_URL}/rest/system/connections",
                    headers=headers,
                ),
                client.get(
                    f"{SYNCTHING_URL}/rest/system/status",
                    headers=headers,
                ),
            )

        devices_response.raise_for_status()
        connections_response.raise_for_status()
        local_status_response.raise_for_status()

        devices_data = devices_response.json()
        connections_data = connections_response.json()
        local_status_data = local_status_response.json()

        if not isinstance(devices_data, list):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=(
                    "Syncthing returned an invalid "
                    "devices response."
                ),
            )

        if not isinstance(connections_data, dict):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=(
                    "Syncthing returned an invalid "
                    "connections response."
                ),
            )

        if not isinstance(local_status_data, dict):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=(
                    "Syncthing returned an invalid "
                    "system status response."
                ),
            )

        connection_map = connections_data.get(
            "connections",
            {},
        )

        if not isinstance(connection_map, dict):
            connection_map = {}

        local_device_id = str(
            local_status_data.get("myID", "")
        ).strip()

        normalized_devices: list[dict[str, Any]] = []

        for device in devices_data:
            if not isinstance(device, dict):
                continue

            device_id = str(
                device.get("deviceID", "")
            ).strip()

            if not device_id:
                continue

            # The local device is managed by this Syncthing
            # instance and should not appear as a remote device.
            if (
                local_device_id
                and device_id == local_device_id
            ):
                continue

            raw_connection = connection_map.get(
                device_id,
                {},
            )

            connection = (
                raw_connection
                if isinstance(raw_connection, dict)
                else {}
            )

            raw_addresses = device.get(
                "addresses",
                [],
            )

            addresses = (
                [
                    str(address)
                    for address in raw_addresses
                    if str(address).strip()
                ]
                if isinstance(raw_addresses, list)
                else []
            )

            connected = bool(
                connection.get("connected", False)
            )

            paused = bool(
                device.get(
                    "paused",
                    connection.get("paused", False),
                )
            )

            device_name = str(
                device.get("name", "")
            ).strip()

            normalized_devices.append(
                {
                    "id": device_id,
                    "name": (
                        device_name
                        or f"Device {device_id[:7]}"
                    ),
                    "short_id": device_id[:7],
                    "addresses": addresses,
                    "connected": connected,
                    "paused": paused,
                    "connection_address": str(
                        connection.get("address", "")
                    ),
                    "connection_type": str(
                        connection.get("type", "")
                    ),
                    "client_version": str(
                        connection.get(
                            "clientVersion",
                            "",
                        )
                    ),
                    "is_local_network": bool(
                        connection.get(
                            "isLocal",
                            False,
                        )
                    ),
                    "in_bytes_total": safe_int(
                        connection.get("inBytesTotal")
                    ),
                    "out_bytes_total": safe_int(
                        connection.get("outBytesTotal")
                    ),
                    "connected_since": str(
                        connection.get(
                            "startedAt",
                            "",
                        )
                    ),
                    "last_seen": str(
                        connection.get(
                            "at",
                            "",
                        )
                    ),
                    "introducer": bool(
                        device.get(
                            "introducer",
                            False,
                        )
                    ),
                    "auto_accept_folders": bool(
                        device.get(
                            "autoAcceptFolders",
                            False,
                        )
                    ),
                    "compression": str(
                        device.get(
                            "compression",
                            "metadata",
                        )
                    ),
                }
            )

        normalized_devices.sort(
            key=lambda item: (
                not item["connected"],
                item["name"].casefold(),
            )
        )

        return normalized_devices

    except HTTPException:
        raise

    except httpx.HTTPStatusError as error:
        response_status = (
            error.response.status_code
            if error.response is not None
            else status.HTTP_502_BAD_GATEWAY
        )

        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Syncthing rejected the devices request "
                f"with status {response_status}."
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

    except (
        TypeError,
        ValueError,
        KeyError,
    ) as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Syncthing returned device data "
                "in an unexpected format."
            ),
        ) from error

# =========================================================
# Syncthing device management
# =========================================================


class CreateSyncthingDeviceRequest(BaseModel):
    """Add a remote device to Syncthing."""

    device_id: str = Field(
        min_length=1,
        max_length=100,
    )

    name: str = Field(
        min_length=1,
        max_length=128,
    )

    addresses: list[str] = Field(
        default_factory=lambda: ["dynamic"],
    )

    compression: Literal[
        "metadata",
        "always",
        "never",
    ] = "metadata"

    paused: bool = False
    introducer: bool = False
    auto_accept_folders: bool = False


class RenameSyncthingDeviceRequest(BaseModel):
    """Change the friendly name of a remote device."""

    name: str = Field(
        min_length=1,
        max_length=128,
    )


class UpdateSyncthingDevicePausedRequest(BaseModel):
    """Pause or resume communication with a device."""

    paused: bool


def normalize_device_name(
    value: str,
) -> str:
    """Normalize and validate a friendly device name."""

    clean_name = " ".join(
        value.strip().split()
    )

    if not clean_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please enter a device name.",
        )

    if len(clean_name) > 128:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "The device name cannot exceed "
                "128 characters."
            ),
        )

    if any(
        ord(character) < 32
        for character in clean_name
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "The device name contains "
                "invalid characters."
            ),
        )

    return clean_name


def normalize_device_addresses(
    addresses: list[str],
) -> list[str]:
    """Normalize the connection addresses for a device."""

    clean_addresses: list[str] = []

    for address in addresses:
        clean_address = str(address).strip()

        if not clean_address:
            continue

        if len(clean_address) > 500:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "One of the device addresses "
                    "is too long."
                ),
            )

        if any(
            ord(character) < 32
            for character in clean_address
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "One of the device addresses "
                    "contains invalid characters."
                ),
            )

        if clean_address not in clean_addresses:
            clean_addresses.append(
                clean_address
            )

    if not clean_addresses:
        clean_addresses.append("dynamic")

    return clean_addresses


async def normalize_syncthing_device_id(
    device_id: str,
) -> str:
    """
    Ask Syncthing to validate and normalize a device ID.
    """

    clean_device_id = device_id.strip()

    if not clean_device_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please enter a device ID.",
        )

    headers = get_syncthing_headers()

    try:
        async with httpx.AsyncClient(
            timeout=10.0,
        ) as client:
            response = await client.get(
                f"{SYNCTHING_URL}/rest/svc/deviceid",
                headers=headers,
                params={
                    "id": clean_device_id,
                },
            )

        response.raise_for_status()
        response_data = response.json()

        if not isinstance(response_data, dict):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=(
                    "Syncthing returned an invalid "
                    "device ID response."
                ),
            )

        validation_error = response_data.get(
            "error"
        )

        if validation_error:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(validation_error),
            )

        normalized_id = str(
            response_data.get("id", "")
        ).strip()

        if not normalized_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The device ID is not valid.",
            )

        return normalized_id

    except HTTPException:
        raise

    except httpx.HTTPStatusError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Syncthing could not validate "
                "the device ID."
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

    except (
        TypeError,
        ValueError,
    ) as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Syncthing returned device ID data "
                "in an unexpected format."
            ),
        ) from error


async def get_local_syncthing_device_id() -> str:
    """Return the ID of this local Syncthing device."""

    headers = get_syncthing_headers()

    try:
        async with httpx.AsyncClient(
            timeout=10.0,
        ) as client:
            response = await client.get(
                f"{SYNCTHING_URL}/rest/system/status",
                headers=headers,
            )

        response.raise_for_status()
        response_data = response.json()

        if not isinstance(response_data, dict):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=(
                    "Syncthing returned an invalid "
                    "system status response."
                ),
            )

        local_device_id = str(
            response_data.get("myID", "")
        ).strip()

        if not local_device_id:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=(
                    "Syncthing did not return "
                    "the local device ID."
                ),
            )

        return local_device_id

    except HTTPException:
        raise

    except httpx.HTTPStatusError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Syncthing rejected the local "
                "device request."
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

    except (
        TypeError,
        ValueError,
    ) as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Syncthing returned local device "
                "data in an unexpected format."
            ),
        ) from error


async def syncthing_device_exists(
    device_id: str,
) -> bool:
    """Return whether a configured device already exists."""

    headers = get_syncthing_headers()

    try:
        async with httpx.AsyncClient(
            timeout=10.0,
        ) as client:
            response = await client.get(
                (
                    f"{SYNCTHING_URL}/rest/config/"
                    f"devices/{device_id}"
                ),
                headers=headers,
            )

        if response.status_code == 404:
            return False

        response.raise_for_status()

        return True

    except httpx.HTTPStatusError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Syncthing could not check "
                "the selected device."
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


@app.get(
    "/api/syncthing/devices/local",
)
async def get_local_syncthing_device() -> dict[str, Any]:
    """Return information needed to share this device."""

    local_device_id = (
        await get_local_syncthing_device_id()
    )

    return {
        "id": local_device_id,
        "short_id": local_device_id[:7],
        "message": (
            "Share this device ID with another "
            "Syncthing device to connect them."
        ),
    }


@app.post(
    "/api/syncthing/devices",
    status_code=status.HTTP_201_CREATED,
)
async def create_syncthing_device(
    request: CreateSyncthingDeviceRequest,
) -> dict[str, Any]:
    """Add a new remote device to Syncthing."""

    normalized_device_id = (
        await normalize_syncthing_device_id(
            request.device_id
        )
    )

    local_device_id = (
        await get_local_syncthing_device_id()
    )

    if normalized_device_id == local_device_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "You cannot add this computer "
                "as its own remote device."
            ),
        )

    if await syncthing_device_exists(
        normalized_device_id
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This device is already registered "
                "in Syncthing."
            ),
        )

    clean_name = normalize_device_name(
        request.name
    )

    clean_addresses = (
        normalize_device_addresses(
            request.addresses
        )
    )

    headers = get_syncthing_headers()

    try:
        async with httpx.AsyncClient(
            timeout=15.0,
        ) as client:
            defaults_response = await client.get(
                (
                    f"{SYNCTHING_URL}/rest/config/"
                    "defaults/device"
                ),
                headers=headers,
            )

            defaults_response.raise_for_status()

            device_configuration = (
                defaults_response.json()
            )

            if not isinstance(
                device_configuration,
                dict,
            ):
                raise HTTPException(
                    status_code=(
                        status.HTTP_502_BAD_GATEWAY
                    ),
                    detail=(
                        "Syncthing returned an invalid "
                        "default device configuration."
                    ),
                )

            device_configuration.update(
                {
                    "deviceID":
                        normalized_device_id,
                    "name": clean_name,
                    "addresses":
                        clean_addresses,
                    "compression":
                        request.compression,
                    "paused":
                        request.paused,
                    "introducer":
                        request.introducer,
                    "autoAcceptFolders":
                        request.auto_accept_folders,
                }
            )

            create_response = await client.post(
                (
                    f"{SYNCTHING_URL}/rest/config/"
                    "devices"
                ),
                headers=headers,
                json=device_configuration,
            )

            create_response.raise_for_status()

        return {
            "created": True,
            "device": {
                "id": normalized_device_id,
                "short_id":
                    normalized_device_id[:7],
                "name": clean_name,
                "addresses": clean_addresses,
                "compression":
                    request.compression,
                "paused": request.paused,
                "introducer":
                    request.introducer,
                "auto_accept_folders":
                    request.auto_accept_folders,
            },
            "message": (
                f"{clean_name} was added "
                "successfully."
            ),
        }

    except HTTPException:
        raise

    except httpx.HTTPStatusError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Syncthing could not add "
                "the selected device."
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

    except (
        TypeError,
        ValueError,
    ) as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Syncthing returned device "
                "configuration data in an "
                "unexpected format."
            ),
        ) from error


@app.patch(
    "/api/syncthing/devices/{device_id}/rename",
)
async def rename_syncthing_device(
    device_id: str,
    request: RenameSyncthingDeviceRequest,
) -> dict[str, Any]:
    """Rename an existing remote device."""

    normalized_device_id = (
        await normalize_syncthing_device_id(
            device_id
        )
    )

    clean_name = normalize_device_name(
        request.name
    )

    headers = get_syncthing_headers()

    try:
        async with httpx.AsyncClient(
            timeout=15.0,
        ) as client:
            response = await client.patch(
                (
                    f"{SYNCTHING_URL}/rest/config/"
                    f"devices/{normalized_device_id}"
                ),
                headers=headers,
                json={
                    "name": clean_name,
                },
            )

        if response.status_code == 404:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=(
                    "The selected device "
                    "does not exist."
                ),
            )

        response.raise_for_status()

        return {
            "renamed": True,
            "id": normalized_device_id,
            "name": clean_name,
            "message": (
                f"Device renamed to {clean_name}."
            ),
        }

    except HTTPException:
        raise

    except httpx.HTTPStatusError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Syncthing could not rename "
                "the selected device."
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
    "/api/syncthing/devices/{device_id}/paused",
)
async def update_syncthing_device_paused(
    device_id: str,
    request: UpdateSyncthingDevicePausedRequest,
) -> dict[str, Any]:
    """Pause or resume an existing remote device."""

    normalized_device_id = (
        await normalize_syncthing_device_id(
            device_id
        )
    )

    headers = get_syncthing_headers()

    try:
        async with httpx.AsyncClient(
            timeout=15.0,
        ) as client:
            response = await client.patch(
                (
                    f"{SYNCTHING_URL}/rest/config/"
                    f"devices/{normalized_device_id}"
                ),
                headers=headers,
                json={
                    "paused": request.paused,
                },
            )

        if response.status_code == 404:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=(
                    "The selected device "
                    "does not exist."
                ),
            )

        response.raise_for_status()

        return {
            "updated": True,
            "id": normalized_device_id,
            "paused": request.paused,
            "message": (
                "Device paused successfully."
                if request.paused
                else "Device resumed successfully."
            ),
        }

    except HTTPException:
        raise

    except httpx.HTTPStatusError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Syncthing could not change "
                "the selected device state."
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


@app.delete(
    "/api/syncthing/devices/{device_id}",
)
async def delete_syncthing_device(
    device_id: str,
) -> dict[str, Any]:
    """Remove a remote device from Syncthing."""

    normalized_device_id = (
        await normalize_syncthing_device_id(
            device_id
        )
    )

    local_device_id = (
        await get_local_syncthing_device_id()
    )

    if normalized_device_id == local_device_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "The local Syncthing device "
                "cannot be removed."
            ),
        )

    headers = get_syncthing_headers()

    try:
        async with httpx.AsyncClient(
            timeout=15.0,
        ) as client:
            response = await client.delete(
                (
                    f"{SYNCTHING_URL}/rest/config/"
                    f"devices/{normalized_device_id}"
                ),
                headers=headers,
            )

        if response.status_code == 404:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=(
                    "The selected device "
                    "does not exist."
                ),
            )

        response.raise_for_status()

        return {
            "deleted": True,
            "id": normalized_device_id,
            "message": (
                "The device was removed "
                "from Syncthing."
            ),
        }

    except HTTPException:
        raise

    except httpx.HTTPStatusError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Syncthing could not remove "
                "the selected device."
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
# OpenUI production frontend
# =========================================================


def get_openui_resource_path(*parts: str) -> Path:
    """Resolve resources in development and PyInstaller builds."""

    bundled_root = getattr(sys, "_MEIPASS", None)
    if bundled_root:
        return Path(str(bundled_root)).joinpath(*parts)

    project_root = Path(__file__).resolve().parent.parent
    return project_root.joinpath(*parts)



FRONTEND_DIST_DIR = get_openui_resource_path(
    "frontend",
    "dist",
)


if FRONTEND_DIST_DIR.is_dir():
    frontend_assets_directory = FRONTEND_DIST_DIR / "assets"

    if frontend_assets_directory.is_dir():
        app.mount(
            "/assets",
            StaticFiles(directory=frontend_assets_directory),
            name="openui-assets",
        )

    @app.get("/{frontend_path:path}", include_in_schema=False)
    async def serve_openui_frontend(frontend_path: str) -> FileResponse:
        """Serve the production React application with safe SPA fallback."""

        normalized_frontend_path = frontend_path.lstrip("/")
        if normalized_frontend_path == "api" or normalized_frontend_path.startswith("api/"):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="API endpoint not found.",
            )

        resolved_dist_directory = FRONTEND_DIST_DIR.resolve()
        requested_file = (FRONTEND_DIST_DIR / normalized_frontend_path).resolve()

        try:
            requested_file.relative_to(resolved_dist_directory)
        except ValueError:
            requested_file = FRONTEND_DIST_DIR / "index.html"

        if normalized_frontend_path and requested_file.is_file():
            return FileResponse(
                requested_file,
                headers={"Cache-Control": "no-cache"},
            )

        index_file = FRONTEND_DIST_DIR / "index.html"
        if not index_file.is_file():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="The OpenUI Hub frontend build is not available.",
            )

        return FileResponse(
            index_file,
            headers={
                "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
                "Pragma": "no-cache",
                "Expires": "0",
            },
        )
