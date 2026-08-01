from __future__ import annotations

import ctypes
import json
import logging
import os
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path
from typing import Any

import uvicorn
from dotenv import dotenv_values


# PyInstaller windowed applications may not provide stdout/stderr.
if sys.stdout is None:
    sys.stdout = open(
        os.devnull,
        "w",
        encoding="utf-8",
    )

if sys.stderr is None:
    sys.stderr = open(
        os.devnull,
        "w",
        encoding="utf-8",
    )



APP_NAME = "OpenUI Hub"
APP_HOST = "127.0.0.1"
APP_PORT_START = 8765
APP_PORT_END = 8775

SYNCTHING_HOST = "127.0.0.1"
SYNCTHING_PORT_START = 8385
SYNCTHING_PORT_END = 8395

HTTP_TIMEOUT_SECONDS = 1.0
STARTUP_TIMEOUT_SECONDS = 40.0


def resource_path(*parts: str) -> Path:
    """
    Resolve a bundled resource in development and PyInstaller builds.
    """

    bundled_root = getattr(sys, "_MEIPASS", None)

    if bundled_root:
        return Path(str(bundled_root)).joinpath(*parts)

    return Path(__file__).resolve().parent.parent.joinpath(*parts)


def get_local_app_data_directory() -> Path:
    """Return OpenUI's writable per-user application directory."""

    local_app_data = os.getenv("LOCALAPPDATA")

    if local_app_data:
        return Path(local_app_data) / "OpenUIHub"

    return Path.home() / ".openui-hub"


APP_DATA_DIR = get_local_app_data_directory()
CONFIG_DIR = APP_DATA_DIR / "config"
LOGS_DIR = APP_DATA_DIR / "logs"
SYNCTHING_HOME_DIR = APP_DATA_DIR / "syncthing"
DEFAULT_FILES_DIR = Path.home() / "OpenUI Files"
SETTINGS_FILE = CONFIG_DIR / "openui.json"
LAUNCHER_LOG_FILE = LOGS_DIR / "launcher.log"
SYNCTHING_LOG_FILE = LOGS_DIR / "syncthing.log"


def create_runtime_directories() -> None:
    """Create every writable directory required by OpenUI."""

    for directory in (
        APP_DATA_DIR,
        CONFIG_DIR,
        LOGS_DIR,
        SYNCTHING_HOME_DIR,
        DEFAULT_FILES_DIR,
    ):
        directory.mkdir(parents=True, exist_ok=True)


def configure_logging() -> None:
    """Write launcher diagnostics to a local log file."""

    logging.basicConfig(
        filename=LAUNCHER_LOG_FILE,
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(message)s",
        encoding="utf-8",
    )


def show_error(message: str) -> None:
    """Show a native Windows error dialog and log the message."""

    logging.error(message)

    if os.name == "nt":
        ctypes.windll.user32.MessageBoxW(
            0,
            message,
            APP_NAME,
            0x10,
        )
    else:
        print(message, file=sys.stderr)


def load_settings() -> dict[str, Any]:
    """Load persistent launcher settings or create safe defaults."""

    default_settings: dict[str, Any] = {
        "app_port": APP_PORT_START,
        "syncthing_port": SYNCTHING_PORT_START,
        "syncthing_api_key": secrets.token_urlsafe(32),
    }

    if not SETTINGS_FILE.is_file():
        save_settings(default_settings)
        return default_settings

    try:
        loaded = json.loads(
            SETTINGS_FILE.read_text(encoding="utf-8")
        )

        if not isinstance(loaded, dict):
            raise ValueError("Invalid settings structure.")

        settings = {
            **default_settings,
            **loaded,
        }

        settings["app_port"] = int(settings["app_port"])
        settings["syncthing_port"] = int(
            settings["syncthing_port"]
        )
        settings["syncthing_api_key"] = str(
            settings["syncthing_api_key"]
        ).strip()

        if not settings["syncthing_api_key"]:
            settings["syncthing_api_key"] = (
                secrets.token_urlsafe(32)
            )

        save_settings(settings)
        return settings

    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        logging.exception(
            "Could not read the launcher settings. "
            "Fresh settings will be created."
        )
        save_settings(default_settings)
        return default_settings


def save_settings(settings: dict[str, Any]) -> None:
    """Save settings atomically in the user's application directory."""

    CONFIG_DIR.mkdir(parents=True, exist_ok=True)

    temporary_file = SETTINGS_FILE.with_suffix(".tmp")

    temporary_file.write_text(
        json.dumps(settings, indent=2),
        encoding="utf-8",
    )

    os.replace(temporary_file, SETTINGS_FILE)


def is_port_open(host: str, port: int) -> bool:
    """Return whether a TCP listener is accepting connections."""

    try:
        with socket.create_connection(
            (host, port),
            timeout=0.35,
        ):
            return True
    except OSError:
        return False


def find_free_port(
    host: str,
    start_port: int,
    end_port: int,
) -> int:
    """Return the first available port in an inclusive range."""

    for port in range(start_port, end_port + 1):
        if not is_port_open(host, port):
            return port

    raise RuntimeError(
        f"No free local port was found between "
        f"{start_port} and {end_port}."
    )


def request_json(
    url: str,
    api_key: str | None = None,
) -> dict[str, Any] | None:
    """Request a small JSON response without external HTTP packages."""

    headers = {
        "Accept": "application/json",
    }

    if api_key:
        headers["X-API-Key"] = api_key

    request = urllib.request.Request(
        url,
        headers=headers,
    )

    try:
        with urllib.request.urlopen(
            request,
            timeout=HTTP_TIMEOUT_SECONDS,
        ) as response:
            payload = json.loads(
                response.read().decode("utf-8")
            )

        return payload if isinstance(payload, dict) else None

    except (
        OSError,
        ValueError,
        urllib.error.URLError,
        urllib.error.HTTPError,
        json.JSONDecodeError,
    ):
        return None


def is_openui_ready(port: int) -> bool:
    """Check whether an OpenUI server is already running."""

    payload = request_json(
        f"http://{APP_HOST}:{port}/api/health"
    )

    return bool(
        payload
        and payload.get("healthy") is True
        and payload.get("service") == "openui-backend"
    )


def is_syncthing_ready(
    syncthing_url: str,
    api_key: str,
) -> bool:
    """Check whether Syncthing accepts the configured API key."""

    payload = request_json(
        f"{syncthing_url.rstrip('/')}/rest/system/status",
        api_key=api_key,
    )

    return bool(
        payload
        and isinstance(payload.get("myID"), str)
        and payload.get("myID")
    )


def load_development_syncthing() -> tuple[str, str] | None:
    """
    Reuse backend/.env while developing.

    The packaged application does not include this file and therefore
    uses its own bundled Syncthing instance.
    """

    environment_file = resource_path(
        "backend",
        ".env",
    )

    if not environment_file.is_file():
        return None

    values = dotenv_values(environment_file)

    url = str(
        values.get(
            "SYNCTHING_URL",
            "http://127.0.0.1:8384",
        )
    ).rstrip("/")

    api_key = str(
        values.get("SYNCTHING_API_KEY", "")
    ).strip()

    if not api_key:
        return None

    if not is_syncthing_ready(url, api_key):
        return None

    return url, api_key


def find_syncthing_executable() -> Path | None:
    """Find the bundled Syncthing binary or a local development copy."""

    candidates = [
        resource_path(
            "vendor",
            "syncthing",
            "syncthing.exe",
        ),
        resource_path("syncthing.exe"),
    ]

    for candidate in candidates:
        if candidate.is_file():
            return candidate

    path_result = shutil.which("syncthing")

    if path_result:
        return Path(path_result)

    common_windows_locations = [
        Path(os.getenv("LOCALAPPDATA", ""))
        / "Programs"
        / "Syncthing"
        / "syncthing.exe",
        Path(os.getenv("PROGRAMFILES", ""))
        / "Syncthing"
        / "syncthing.exe",
    ]

    for candidate in common_windows_locations:
        if candidate.is_file():
            return candidate

    return None


def start_syncthing(
    executable: Path,
    port: int,
    api_key: str,
) -> subprocess.Popen[bytes]:
    """Start OpenUI's isolated Syncthing process."""

    command = [
        str(executable),
        "serve",
        f"--home={SYNCTHING_HOME_DIR}",
        (
            "--gui-address="
            f"http://{SYNCTHING_HOST}:{port}"
        ),
        f"--gui-apikey={api_key}",
        "--no-browser",
        "--no-restart",
        "--no-upgrade",
        f"--log-file={SYNCTHING_LOG_FILE}",
        "--log-max-size=10485760",
        "--log-max-old-files=3",
    ]

    creation_flags = 0

    if os.name == "nt":
        creation_flags = subprocess.CREATE_NO_WINDOW

    logging.info(
        "Starting Syncthing from %s on port %s.",
        executable,
        port,
    )

    return subprocess.Popen(
        command,
        cwd=str(SYNCTHING_HOME_DIR),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=creation_flags,
    )


def wait_for_syncthing(
    process: subprocess.Popen[bytes],
    syncthing_url: str,
    api_key: str,
) -> None:
    """Wait until the Syncthing REST API becomes available."""

    deadline = time.monotonic() + STARTUP_TIMEOUT_SECONDS

    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(
                "Syncthing stopped during startup. "
                f"Check {SYNCTHING_LOG_FILE}."
            )

        if is_syncthing_ready(
            syncthing_url,
            api_key,
        ):
            logging.info("Syncthing is ready.")
            return

        time.sleep(0.5)

    raise RuntimeError(
        "Syncthing did not become ready in time. "
        f"Check {SYNCTHING_LOG_FILE}."
    )


def terminate_process(
    process: subprocess.Popen[bytes] | None,
) -> None:
    """Stop a child process started by this launcher."""

    if process is None or process.poll() is not None:
        return

    logging.info("Stopping Syncthing.")

    process.terminate()

    try:
        process.wait(timeout=8.0)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=3.0)


def open_browser_when_ready(
    app_url: str,
    port: int,
) -> None:
    """Open the default browser after FastAPI is responding."""

    deadline = time.monotonic() + STARTUP_TIMEOUT_SECONDS

    while time.monotonic() < deadline:
        if is_openui_ready(port):
            logging.info("Opening %s.", app_url)
            webbrowser.open(app_url, new=1)
            return

        time.sleep(0.4)

    logging.error(
        "OpenUI did not become ready before the browser timeout."
    )


def main() -> int:
    """Start Syncthing, FastAPI and the OpenUI browser interface."""

    create_runtime_directories()
    configure_logging()

    logging.info("Starting %s.", APP_NAME)

    settings = load_settings()

    preferred_app_port = int(settings["app_port"])

    if is_openui_ready(preferred_app_port):
        webbrowser.open(
            f"http://{APP_HOST}:{preferred_app_port}",
            new=1,
        )
        return 0

    if is_port_open(APP_HOST, preferred_app_port):
        app_port = find_free_port(
            APP_HOST,
            APP_PORT_START,
            APP_PORT_END,
        )
    else:
        app_port = preferred_app_port

    settings["app_port"] = app_port

    syncthing_process: subprocess.Popen[bytes] | None = None

    try:
        development_syncthing = load_development_syncthing()

        if development_syncthing:
            syncthing_url, syncthing_api_key = (
                development_syncthing
            )
            logging.info(
                "Using the development Syncthing instance at %s.",
                syncthing_url,
            )

        else:
            syncthing_api_key = str(
                settings["syncthing_api_key"]
            )

            preferred_syncthing_port = int(
                settings["syncthing_port"]
            )

            preferred_syncthing_url = (
                f"http://{SYNCTHING_HOST}:"
                f"{preferred_syncthing_port}"
            )

            if is_syncthing_ready(
                preferred_syncthing_url,
                syncthing_api_key,
            ):
                syncthing_url = preferred_syncthing_url

            else:
                if is_port_open(
                    SYNCTHING_HOST,
                    preferred_syncthing_port,
                ):
                    syncthing_port = find_free_port(
                        SYNCTHING_HOST,
                        SYNCTHING_PORT_START,
                        SYNCTHING_PORT_END,
                    )
                else:
                    syncthing_port = preferred_syncthing_port

                executable = find_syncthing_executable()

                if executable is None:
                    raise RuntimeError(
                        "Syncthing was not found. Place "
                        "syncthing.exe inside "
                        "vendor\\syncthing before building "
                        "the Windows application."
                    )

                settings["syncthing_port"] = syncthing_port

                syncthing_url = (
                    f"http://{SYNCTHING_HOST}:"
                    f"{syncthing_port}"
                )

                syncthing_process = start_syncthing(
                    executable,
                    syncthing_port,
                    syncthing_api_key,
                )

                wait_for_syncthing(
                    syncthing_process,
                    syncthing_url,
                    syncthing_api_key,
                )

        save_settings(settings)

        # Set these before importing backend.main. python-dotenv does
        # not overwrite existing environment variables by default.
        os.environ["SYNCTHING_URL"] = syncthing_url
        os.environ["SYNCTHING_API_KEY"] = syncthing_api_key
        os.environ.setdefault(
            "OPENUI_ALLOWED_ROOT",
            str(Path.home()),
        )

        # When running launcher.py directly, make the project root
        # importable so Python can find the backend package.
        project_root = resource_path()

        if str(project_root) not in sys.path:
            sys.path.insert(0, str(project_root))

        from backend.main import app

        app_url = f"http://{APP_HOST}:{app_port}"

        browser_thread = threading.Thread(
            target=open_browser_when_ready,
            args=(app_url, app_port),
            daemon=True,
        )
        browser_thread.start()

        logging.info(
            "Starting OpenUI at %s.",
            app_url,
        )

        uvicorn.run(
            app,
            host=APP_HOST,
            port=app_port,
            log_config=None,
            access_log=False,
        )

        return 0

    except Exception as error:
        logging.exception("OpenUI failed to start.")
        show_error(
            f"OpenUI Hub could not start.\n\n"
            f"{error}\n\n"
            f"Diagnostic log:\n{LAUNCHER_LOG_FILE}"
        )
        return 1

    finally:
        terminate_process(syncthing_process)


if __name__ == "__main__":
    raise SystemExit(main())
