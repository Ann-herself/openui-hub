import os
from pathlib import Path
from typing import Literal
from uuid import uuid4

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


# ---------------------------------------------------------
# Basic configuration
# ---------------------------------------------------------

BASE_DIR = Path(__file__).resolve().parent

# Read backend/.env even if the server is started
# from another folder.
load_dotenv(BASE_DIR / ".env")

SYNCTHING_URL = os.getenv(
    "SYNCTHING_URL",
    "http://127.0.0.1:8384",
).rstrip("/")

SYNCTHING_API_KEY = os.getenv("SYNCTHING_API_KEY")

# For security, OpenUI can create folders only inside
# the user's home folder by default.
#
# Example:
# C:\Users\admin
#
# You can change this later in backend/.env:
# OPENUI_ALLOWED_ROOT=D:\OpenUI
OPENUI_ALLOWED_ROOT = Path(
    os.getenv(
        "OPENUI_ALLOWED_ROOT",
        str(Path.home()),
    )
).expanduser().resolve()


# ---------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------

app = FastAPI(
    title="OpenUI Hub API",
    version="0.0.2",
    description=(
        "A simple interface for managing Syncthing "
        "and other self-hosted open-source applications."
    ),
)


# Allow the React frontend to communicate with FastAPI.
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


# ---------------------------------------------------------
# Request models
# ---------------------------------------------------------

class CreateFolderRequest(BaseModel):
    label: str = Field(
        min_length=1,
        max_length=128,
        description="The name shown to the user.",
    )

    path: str = Field(
        min_length=3,
        max_length=500,
        description="The complete local Windows folder path.",
    )

    folder_type: Literal[
        "sendreceive",
        "sendonly",
        "receiveonly",
    ] = "sendreceive"


# ---------------------------------------------------------
# Helper functions
# ---------------------------------------------------------

def get_syncthing_headers() -> dict[str, str]:
    """Return the authentication headers for Syncthing."""

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
    """Normalize a filesystem path for reliable comparisons."""

    return os.path.normcase(
        os.path.abspath(
            os.path.expanduser(str(value))
        )
    )


def ensure_path_is_allowed(folder_path: Path) -> None:
    """
    Prevent OpenUI from creating folders outside the
    configured safe directory.
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


# ---------------------------------------------------------
# General routes
# ---------------------------------------------------------

@app.get("/")
def home():
    """Return basic OpenUI server information."""

    return {
        "message": "OpenUI Backend is working",
        "version": "0.0.2",
    }


@app.get("/api/health")
def openui_health():
    """Return the health of the OpenUI backend itself."""

    return {
        "healthy": True,
        "service": "openui-backend",
    }


# ---------------------------------------------------------
# Syncthing status
# ---------------------------------------------------------

@app.get("/api/syncthing/status")
async def get_syncthing_status():
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
            "uptime_seconds": status_data.get("uptime"),
            "memory_bytes": status_data.get("sys"),
            "syncthing_version": version_data.get("version"),
            "operating_system": version_data.get("os"),
            "architecture": version_data.get("arch"),
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


# ---------------------------------------------------------
# List Syncthing folders
# ---------------------------------------------------------

@app.get("/api/syncthing/folders")
async def get_syncthing_folders():
    """Return all folders configured in Syncthing."""

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
        ]

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


# ---------------------------------------------------------
# Create a new Syncthing folder
# ---------------------------------------------------------

@app.post(
    "/api/syncthing/folders",
    status_code=status.HTTP_201_CREATED,
)
async def create_syncthing_folder(
    folder: CreateFolderRequest,
):
    """
    Create a physical folder on the computer and add it
    to Syncthing without opening the Syncthing interface.
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
            # Check whether this path is already registered.
            folders_response = await client.get(
                f"{SYNCTHING_URL}/rest/config/folders",
                headers=headers,
            )

            folders_response.raise_for_status()
            existing_folders = folders_response.json()

            requested_path = normalize_path(folder_path)

            for existing_folder in existing_folders:
                existing_path = existing_folder.get("path")

                if not existing_path:
                    continue

                if normalize_path(existing_path) == requested_path:
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=(
                            "This folder is already registered "
                            "in Syncthing."
                        ),
                    )

            # Get Syncthing's default folder configuration.
            defaults_response = await client.get(
                (
                    f"{SYNCTHING_URL}"
                    "/rest/config/defaults/folder"
                ),
                headers=headers,
            )

            defaults_response.raise_for_status()
            folder_config = defaults_response.json()

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

            # Add the new folder to Syncthing.
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
                "Check the selected path and available space."
            ),
        ) from error

    except httpx.HTTPStatusError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Syncthing could not add the folder. "
                "Check whether the path or folder ID "
                "is already registered."
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