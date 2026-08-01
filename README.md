# OpenUI Hub

OpenUI Hub is a unified and user-friendly interface for self-hosted open-source applications.

## Current Status

The project is currently in its early development stage.

The first supported application will be Syncthing.

## Planned Integrations

- Syncthing
- Paperless-ngx
- Immich
- Gitea
- Nextcloud

## Backend

The backend is built using:

- Python
- FastAPI
- Uvicorn

## Development

Start the backend (project root):

```
uvicorn backend.main:app --reload --port 8765
```

Start the frontend dev server (frontend folder):

```
npm install
npm run dev
```

The Vite dev server runs on http://localhost:5173 and forwards API calls to the backend at http://127.0.0.1:8765.

## Current Version

v1.0.1
