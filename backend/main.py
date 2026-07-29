import os

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException


load_dotenv()

app = FastAPI(
    title="OpenUI Hub API",
    version="0.0.1",
)

SYNCTHING_URL = os.getenv(
    "SYNCTHING_URL",
    "http://127.0.0.1:8384",
).rstrip("/")

SYNCTHING_API_KEY = os.getenv("SYNCTHING_API_KEY")


@app.get("/")
def home():
    return {
        "message": "OpenUI Backend is working",
    }


@app.get("/api/syncthing/status")
async def get_syncthing_status():
    if not SYNCTHING_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="Syncthing API Key is missing from the .env file",
        )

    headers = {
        "X-API-Key": SYNCTHING_API_KEY,
    }

    try:
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