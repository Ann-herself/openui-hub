import {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import "./App.css";

type SyncthingStatus = {
  connected: boolean;
  device_id: string;
  uptime_seconds: number;
  memory_bytes: number;
  syncthing_version: string;
  operating_system: string;
  architecture: string;
};

type SyncthingFolder = {
  id: string;
  label: string;
  path: string;
  type: string;
  paused: boolean;
  device_count: number;
};

type FolderType =
  | "sendreceive"
  | "sendonly"
  | "receiveonly";

type FolderAction = "open" | "scan";

const API_URL = "http://127.0.0.1:8000";

async function readResponseData(response: Response) {
  return response.json().catch(() => ({}));
}

function App() {
  const [status, setStatus] =
    useState<SyncthingStatus | null>(null);

  const [folders, setFolders] =
    useState<SyncthingFolder[]>([]);

  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [activeMenuId, setActiveMenuId] =
    useState<string | null>(null);

  const [actionLoading, setActionLoading] =
    useState<string | null>(null);

  const [notice, setNotice] = useState("");

  // Create folder modal
  const [isCreateOpen, setIsCreateOpen] =
    useState(false);

  const [folderLabel, setFolderLabel] =
    useState("");

  const [folderPath, setFolderPath] =
    useState("");

  const [folderType, setFolderType] =
    useState<FolderType>("sendreceive");

  const [createLoading, setCreateLoading] =
    useState(false);

  const [createError, setCreateError] =
    useState("");

  // Rename modal
  const [renameTarget, setRenameTarget] =
    useState<SyncthingFolder | null>(null);

  const [renameLabel, setRenameLabel] =
    useState("");

  const [renameLoading, setRenameLoading] =
    useState(false);

  const [renameError, setRenameError] =
    useState("");

  // Remove confirmation modal
  const [removeTarget, setRemoveTarget] =
    useState<SyncthingFolder | null>(null);

  const [removeLoading, setRemoveLoading] =
    useState(false);

  const [removeError, setRemoveError] =
    useState("");

  async function loadData() {
    try {
      setLoading(true);
      setError("");

      const [statusResponse, foldersResponse] =
        await Promise.all([
          fetch(`${API_URL}/api/syncthing/status`),
          fetch(`${API_URL}/api/syncthing/folders`),
        ]);

      const statusData =
        await readResponseData(statusResponse);

      const foldersData =
        await readResponseData(foldersResponse);

      if (!statusResponse.ok) {
        throw new Error(
          statusData.detail ||
            "Could not load Syncthing status.",
        );
      }

      if (!foldersResponse.ok) {
        throw new Error(
          foldersData.detail ||
            "Could not load folders.",
        );
      }

      setStatus(statusData);
      setFolders(foldersData);
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : "An unknown error occurred.";

      setError(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    function closeMenus() {
      setActiveMenuId(null);
    }

    window.addEventListener("click", closeMenus);

    return () => {
      window.removeEventListener(
        "click",
        closeMenus,
      );
    };
  }, []);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setNotice("");
    }, 3500);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [notice]);

  const filteredFolders = useMemo(() => {
    const searchValue =
      search.trim().toLowerCase();

    if (!searchValue) {
      return folders;
    }

    return folders.filter((folder) => {
      return (
        folder.label
          .toLowerCase()
          .includes(searchValue) ||
        folder.path
          .toLowerCase()
          .includes(searchValue)
      );
    });
  }, [folders, search]);

  function showSuccess(message: string) {
    setNotice(message);
  }

  function showError(message: string) {
    setNotice(`Error: ${message}`);
  }

  // -------------------------------------------------------
  // Create folder
  // -------------------------------------------------------

  function openCreateDialog() {
    setFolderLabel("");
    setFolderPath("");
    setFolderType("sendreceive");
    setCreateError("");
    setIsCreateOpen(true);
  }

  function closeCreateDialog() {
    if (createLoading) {
      return;
    }

    setIsCreateOpen(false);
    setCreateError("");
  }

  async function createFolder(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const cleanLabel = folderLabel.trim();
    const cleanPath = folderPath.trim();

    if (!cleanLabel) {
      setCreateError(
        "Please enter a folder name.",
      );
      return;
    }

    if (!cleanPath) {
      setCreateError(
        "Please enter the folder location.",
      );
      return;
    }

    try {
      setCreateLoading(true);
      setCreateError("");

      const response = await fetch(
        `${API_URL}/api/syncthing/folders`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            label: cleanLabel,
            path: cleanPath,
            folder_type: folderType,
          }),
        },
      );

      const data =
        await readResponseData(response);

      if (!response.ok) {
        throw new Error(
          data.detail ||
            "The folder could not be created.",
        );
      }

      setIsCreateOpen(false);
      setFolderLabel("");
      setFolderPath("");
      setFolderType("sendreceive");

      showSuccess(
        `${cleanLabel} was created successfully.`,
      );

      await loadData();
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : "The folder could not be created.";

      setCreateError(message);
    } finally {
      setCreateLoading(false);
    }
  }

  // -------------------------------------------------------
  // Open and scan
  // -------------------------------------------------------

  async function runFolderAction(
    folder: SyncthingFolder,
    action: FolderAction,
  ) {
    const actionKey = `${folder.id}-${action}`;

    try {
      setActiveMenuId(null);
      setActionLoading(actionKey);

      const response = await fetch(
        `${API_URL}/api/syncthing/folders/${encodeURIComponent(
          folder.id,
        )}/${action}`,
        {
          method: "POST",
        },
      );

      const data =
        await readResponseData(response);

      if (!response.ok) {
        throw new Error(
          data.detail ||
            `Could not ${action} the folder.`,
        );
      }

      if (action === "open") {
        showSuccess(
          `${folder.label} was opened.`,
        );
      } else {
        showSuccess(
          `Syncthing started scanning ${folder.label}.`,
        );
      }
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : "The folder action failed.";

      showError(message);
    } finally {
      setActionLoading(null);
    }
  }

  // -------------------------------------------------------
  // Pause and resume
  // -------------------------------------------------------

  async function toggleFolderPaused(
    folder: SyncthingFolder,
  ) {
    const newPausedValue = !folder.paused;
    const actionKey = `${folder.id}-paused`;

    try {
      setActiveMenuId(null);
      setActionLoading(actionKey);

      const response = await fetch(
        `${API_URL}/api/syncthing/folders/${encodeURIComponent(
          folder.id,
        )}/paused`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            paused: newPausedValue,
          }),
        },
      );

      const data =
        await readResponseData(response);

      if (!response.ok) {
        throw new Error(
          data.detail ||
            "The folder state could not be changed.",
        );
      }

      showSuccess(
        newPausedValue
          ? `${folder.label} was paused.`
          : `${folder.label} was resumed.`,
      );

      await loadData();
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : "The folder state could not be changed.";

      showError(message);
    } finally {
      setActionLoading(null);
    }
  }

  // -------------------------------------------------------
  // Rename
  // -------------------------------------------------------

  function openRenameDialog(
    folder: SyncthingFolder,
  ) {
    setActiveMenuId(null);
    setRenameTarget(folder);
    setRenameLabel(folder.label);
    setRenameError("");
  }

  function closeRenameDialog() {
    if (renameLoading) {
      return;
    }

    setRenameTarget(null);
    setRenameLabel("");
    setRenameError("");
  }

  async function renameFolder(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!renameTarget) {
      return;
    }

    const cleanLabel = renameLabel.trim();

    if (!cleanLabel) {
      setRenameError(
        "Please enter a folder name.",
      );
      return;
    }

    try {
      setRenameLoading(true);
      setRenameError("");

      const response = await fetch(
        `${API_URL}/api/syncthing/folders/${encodeURIComponent(
          renameTarget.id,
        )}/rename`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            label: cleanLabel,
          }),
        },
      );

      const data =
        await readResponseData(response);

      if (!response.ok) {
        throw new Error(
          data.detail ||
            "The folder could not be renamed.",
        );
      }

      setRenameTarget(null);
      setRenameLabel("");

      showSuccess(
        `Folder renamed to ${cleanLabel}.`,
      );

      await loadData();
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : "The folder could not be renamed.";

      setRenameError(message);
    } finally {
      setRenameLoading(false);
    }
  }

  // -------------------------------------------------------
  // Remove from Syncthing
  // -------------------------------------------------------

  function openRemoveDialog(
    folder: SyncthingFolder,
  ) {
    setActiveMenuId(null);
    setRemoveTarget(folder);
    setRemoveError("");
  }

  function closeRemoveDialog() {
    if (removeLoading) {
      return;
    }

    setRemoveTarget(null);
    setRemoveError("");
  }

  async function removeFolder() {
    if (!removeTarget) {
      return;
    }

    try {
      setRemoveLoading(true);
      setRemoveError("");

      const response = await fetch(
        `${API_URL}/api/syncthing/folders/${encodeURIComponent(
          removeTarget.id,
        )}`,
        {
          method: "DELETE",
        },
      );

      const data =
        await readResponseData(response);

      if (!response.ok) {
        throw new Error(
          data.detail ||
            "The folder could not be removed.",
        );
      }

      const removedLabel = removeTarget.label;

      setRemoveTarget(null);

      showSuccess(
        `${removedLabel} was removed from Syncthing. Your files were not deleted.`,
      );

      await loadData();
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : "The folder could not be removed.";

      setRemoveError(message);
    } finally {
      setRemoveLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">O</div>

          <div>
            <strong>OpenUI</strong>
            <span>Self-hosted cloud</span>
          </div>
        </div>

        <button
          className="new-button"
          type="button"
          onClick={openCreateDialog}
        >
          <span>＋</span>
          New
        </button>

        <nav className="navigation">
          <button
            className="nav-item active"
            type="button"
          >
            <span className="nav-icon">▣</span>
            My Files
          </button>

          <button
            className="nav-item"
            type="button"
          >
            <span className="nav-icon">⇄</span>
            Sync Folders
          </button>

          <button
            className="nav-item"
            type="button"
          >
            <span className="nav-icon">◉</span>
            Devices
          </button>

          <button
            className="nav-item"
            type="button"
          >
            <span className="nav-icon">◷</span>
            Activity
          </button>

          <button
            className="nav-item"
            type="button"
          >
            <span className="nav-icon">⚙</span>
            Settings
          </button>
        </nav>

        <div className="sidebar-status">
          <span
            className={
              status?.connected
                ? "connection-dot online"
                : "connection-dot"
            }
          />

          <div>
            <strong>
              {status?.connected
                ? "Connected"
                : "Offline"}
            </strong>

            <span>
              Syncthing{" "}
              {status?.syncthing_version || ""}
            </span>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <label className="search-box">
            <span>⌕</span>

            <input
              type="search"
              placeholder="Search in your files"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
              }}
            />
          </label>

          <button
            className="refresh-button"
            type="button"
            onClick={loadData}
            aria-label="Refresh folders"
            title="Refresh"
          >
            ↻
          </button>

          <div className="user-avatar">AM</div>
        </header>

        <section className="content">
          <div className="page-heading">
            <div>
              <p className="page-eyebrow">
                OPENUI HUB
              </p>

              <h1>My Files</h1>

              <p>
                Your Syncthing folders in one
                simple place.
              </p>
            </div>

            {status?.connected && (
              <div className="connection-badge">
                <span className="connection-dot online" />
                Syncthing connected
              </div>
            )}
          </div>

          {loading && (
            <div className="state-card">
              Loading your folders...
            </div>
          )}

          {error && (
            <div className="state-card error-card">
              <strong>Connection failed</strong>
              <p>{error}</p>

              <button
                type="button"
                onClick={loadData}
              >
                Try again
              </button>
            </div>
          )}

          {!loading && !error && (
            <>
              <div className="section-heading">
                <div>
                  <h2>Folders</h2>

                  <span>
                    {filteredFolders.length} folder
                    {filteredFolders.length === 1
                      ? ""
                      : "s"}
                  </span>
                </div>

                <button
                  className="view-button active"
                  type="button"
                  title="Grid view"
                >
                  ▦
                </button>
              </div>

              {filteredFolders.length > 0 ? (
                <div className="folder-grid">
                  {filteredFolders.map(
                    (folder) => (
                      <article
                        className={
                          folder.paused
                            ? "folder-card paused-folder"
                            : "folder-card"
                        }
                        key={folder.id}
                      >
                        <div className="folder-card-top">
                          <div className="folder-icon">
                            <span />
                          </div>

                          <div
                            className="folder-menu-wrap"
                            onClick={(event) => {
                              event.stopPropagation();
                            }}
                          >
                            <button
                              className="more-button"
                              type="button"
                              title="Folder options"
                              aria-label={`Options for ${folder.label}`}
                              onClick={() => {
                                setActiveMenuId(
                                  activeMenuId ===
                                    folder.id
                                    ? null
                                    : folder.id,
                                );
                              }}
                            >
                              •••
                            </button>

                            {activeMenuId ===
                              folder.id && (
                              <div className="folder-menu">
                                <button
                                  type="button"
                                  onClick={() => {
                                    runFolderAction(
                                      folder,
                                      "open",
                                    );
                                  }}
                                  disabled={
                                    actionLoading !==
                                    null
                                  }
                                >
                                  <span>↗</span>
                                  Open folder
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    runFolderAction(
                                      folder,
                                      "scan",
                                    );
                                  }}
                                  disabled={
                                    actionLoading !==
                                    null ||
                                    folder.paused
                                  }
                                >
                                  <span>↻</span>
                                  Rescan
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    toggleFolderPaused(
                                      folder,
                                    );
                                  }}
                                  disabled={
                                    actionLoading !==
                                    null
                                  }
                                >
                                  <span>
                                    {folder.paused
                                      ? "▶"
                                      : "Ⅱ"}
                                  </span>

                                  {folder.paused
                                    ? "Resume sync"
                                    : "Pause sync"}
                                </button>

                                <button
                                  type="button"
                                  onClick={() => {
                                    openRenameDialog(
                                      folder,
                                    );
                                  }}
                                  disabled={
                                    actionLoading !==
                                    null
                                  }
                                >
                                  <span>✎</span>
                                  Rename
                                </button>

                                <button
                                  className="menu-danger"
                                  type="button"
                                  onClick={() => {
                                    openRemoveDialog(
                                      folder,
                                    );
                                  }}
                                  disabled={
                                    actionLoading !==
                                    null
                                  }
                                >
                                  <span>×</span>
                                  Remove from Syncthing
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        <h3>{folder.label}</h3>

                        <p className="folder-path">
                          {folder.path}
                        </p>

                        <div className="folder-meta">
                          <span
                            className={
                              folder.paused
                                ? "folder-status paused"
                                : "folder-status"
                            }
                          >
                            {folder.paused
                              ? "Sync paused"
                              : "Sync active"}
                          </span>

                          <span>
                            {folder.device_count} device
                            {folder.device_count === 1
                              ? ""
                              : "s"}
                          </span>
                        </div>
                      </article>
                    ),
                  )}
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-folder">
                    <span />
                  </div>

                  <h2>No folders found</h2>

                  <p>
                    Try another search or create a
                    new sync folder.
                  </p>
                </div>
              )}

              <section className="quick-info">
                <article>
                  <span>Syncthing</span>
                  <strong>
                    {status?.syncthing_version ||
                      "—"}
                  </strong>
                </article>

                <article>
                  <span>System</span>
                  <strong>
                    {status
                      ? `${status.operating_system} · ${status.architecture}`
                      : "—"}
                  </strong>
                </article>

                <article>
                  <span>Device</span>
                  <strong>
                    {status?.device_id
                      ? `${status.device_id.slice(
                          0,
                          7,
                        )}…`
                      : "—"}
                  </strong>
                </article>
              </section>
            </>
          )}
        </section>
      </main>

      {notice && (
        <div
          className={
            notice.startsWith("Error:")
              ? "app-notice error"
              : "app-notice"
          }
        >
          {notice}
        </div>
      )}

      {/* Create folder modal */}
      {isCreateOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              closeCreateDialog();
            }
          }}
        >
          <section
            className="create-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-folder-title"
          >
            <div className="modal-header">
              <div>
                <p>NEW SYNC FOLDER</p>
                <h2 id="create-folder-title">
                  Create a folder
                </h2>
              </div>

              <button
                className="modal-close"
                type="button"
                onClick={closeCreateDialog}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <form
              className="create-form"
              onSubmit={createFolder}
            >
              <label className="form-field">
                <span>Folder name</span>

                <input
                  type="text"
                  placeholder="Example: Projects"
                  value={folderLabel}
                  onChange={(event) => {
                    setFolderLabel(
                      event.target.value,
                    );
                  }}
                  autoFocus
                />
              </label>

              <label className="form-field">
                <span>
                  Location on this computer
                </span>

                <input
                  type="text"
                  placeholder="C:/Users/admin/Projects"
                  value={folderPath}
                  onChange={(event) => {
                    setFolderPath(
                      event.target.value,
                    );
                  }}
                />
              </label>

              <label className="form-field">
                <span>Sync mode</span>

                <select
                  value={folderType}
                  onChange={(event) => {
                    setFolderType(
                      event.target
                        .value as FolderType,
                    );
                  }}
                >
                  <option value="sendreceive">
                    Keep files synchronized everywhere
                  </option>

                  <option value="sendonly">
                    Send files from this device only
                  </option>

                  <option value="receiveonly">
                    Receive files on this device only
                  </option>
                </select>
              </label>

              {createError && (
                <div className="form-error">
                  {createError}
                </div>
              )}

              <div className="modal-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={closeCreateDialog}
                  disabled={createLoading}
                >
                  Cancel
                </button>

                <button
                  className="primary-button"
                  type="submit"
                  disabled={createLoading}
                >
                  {createLoading
                    ? "Creating..."
                    : "Create folder"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* Rename modal */}
      {renameTarget && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              closeRenameDialog();
            }
          }}
        >
          <section
            className="create-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-folder-title"
          >
            <div className="modal-header">
              <div>
                <p>RENAME FOLDER</p>
                <h2 id="rename-folder-title">
                  Change folder name
                </h2>
              </div>

              <button
                className="modal-close"
                type="button"
                onClick={closeRenameDialog}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <form
              className="create-form"
              onSubmit={renameFolder}
            >
              <label className="form-field">
                <span>Folder name</span>

                <input
                  type="text"
                  value={renameLabel}
                  onChange={(event) => {
                    setRenameLabel(
                      event.target.value,
                    );
                  }}
                  autoFocus
                />

                <small>
                  This changes the name shown in
                  OpenUI and Syncthing. The Windows
                  folder path will stay unchanged.
                </small>
              </label>

              {renameError && (
                <div className="form-error">
                  {renameError}
                </div>
              )}

              <div className="modal-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={closeRenameDialog}
                  disabled={renameLoading}
                >
                  Cancel
                </button>

                <button
                  className="primary-button"
                  type="submit"
                  disabled={renameLoading}
                >
                  {renameLoading
                    ? "Renaming..."
                    : "Save name"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* Remove confirmation modal */}
      {removeTarget && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              closeRemoveDialog();
            }
          }}
        >
          <section
            className="create-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-folder-title"
          >
            <div className="modal-header">
              <div>
                <p>REMOVE SYNC FOLDER</p>
                <h2 id="remove-folder-title">
                  Remove {removeTarget.label}?
                </h2>
              </div>

              <button
                className="modal-close"
                type="button"
                onClick={closeRemoveDialog}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="create-form">
              <div className="remove-warning">
                <strong>
                  Your files will not be deleted.
                </strong>

                <p>
                  This action only removes the folder
                  from Syncthing and OpenUI.
                </p>
              </div>

              <div className="remove-path">
                <span>Files will remain at:</span>
                <strong>{removeTarget.path}</strong>
              </div>

              {removeError && (
                <div className="form-error">
                  {removeError}
                </div>
              )}

              <div className="modal-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={closeRemoveDialog}
                  disabled={removeLoading}
                >
                  Cancel
                </button>

                <button
                  className="danger-button"
                  type="button"
                  onClick={removeFolder}
                  disabled={removeLoading}
                >
                  {removeLoading
                    ? "Removing..."
                    : "Remove from Syncthing"}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;