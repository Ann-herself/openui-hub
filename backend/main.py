import os

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware


# Read environment variables from backend/.env
load_dotenv()

app = FastAPI(
    title="OpenUI Hub API",
    version="0.0.1",
)

# Allow the React frontend to communicate with the backend
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

SYNCTHING_URL = os.getenv(
    "SYNCTHING_URL",
    "http://127.0.0.1:8384",
).rstrip("/")

SYNCTHING_API_KEY = os.getenv("SYNCTHING_API_KEY")


def get_syncthing_headers() -> dict[str, str]:
    """Create the headers required by the Syncthing API."""

    if not SYNCTHING_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="Syncthing API Key is missing from the .env file",
        )

    return {
        "X-API-Key": SYNCTHING_API_KEY,
    }


@app.get("/")
def home():
    return {
        "message": "OpenUI Backend is working",
        "version": "0.0.1",
    }


@app.get("/api/syncthing/status")
async def get_syncthing_status():
    """Return the current Syncthing status and version information."""

    try:
        headers = get_syncthing_headers()

        async with httpx.AsyncClient(timeout=10.0) as client:
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
            status_code=502,
            detail="Syncthing rejected the request. Check the API Key.",
        ) from error

    except httpx.RequestError as error:
        raise HTTPException(
            status_code=502,
            detail=(
                "Could not connect to Syncthing. "
                "Make sure Syncthing is running."
            ),
        ) from error


@app.get("/api/syncthing/folders")
async def get_syncthing_folders():
    """Return all folders configured in Syncthing."""

    try:
        headers = get_syncthing_headers()

        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{SYNCTHING_URL}/rest/config/folders",
                headers=headers,
            )

            response.raise_for_status()
            folders = response.json()

            return [
                {
                    "id": folder.get("id"),
                    "label": folder.get("label") or folder.get("id"),
                    "path": folder.get("path"),
                    "type": folder.get("type"),
                    "paused": folder.get("paused", False),
                    "device_count": len(folder.get("devices", [])),
                }
                for folder in folders
            ]

    except httpx.HTTPStatusError as error:
        raise HTTPException(
            status_code=502,
            detail="Syncthing rejected the folders request.",
        ) from error

    except httpx.RequestError as error:
        raise HTTPException(
            status_code=502,
            detail=(
                "Could not connect to Syncthing. "
                "Make sure Syncthing is running."
            ),
        ) from error