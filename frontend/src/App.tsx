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

type BrowserEntry = {
  name: string;
  path: string;
  type: "folder" | "file";
  is_folder: boolean;
  size_bytes: number | null;
  extension: string;
  modified_at: string;
};

type BrowserBreadcrumb = {
  label: string;
  path: string;
};

type BrowserResponse = {
  folder: {
    id: string;
    label: string;
    root_path: string;
  };
  current_path: string;
  breadcrumbs: BrowserBreadcrumb[];
  entries: BrowserEntry[];
  entry_count: number;
};

const API_URL = "http://127.0.0.1:8000";

async function readResponseData(response: Response) {
  return response.json().catch(() => ({}));
}

function formatFileSize(size: number | null) {
  if (size === null) {
    return "";
  }

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  if (size < 1024 * 1024 * 1024) {
    return `${(
      size /
      (1024 * 1024)
    ).toFixed(1)} MB`;
  }

  return `${(
    size /
    (1024 * 1024 * 1024)
  ).toFixed(1)} GB`;
}

function formatModifiedDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getFileLabel(entry: BrowserEntry) {
  const extension = entry.extension
    .replace(".", "")
    .toUpperCase();

  return extension || "FILE";
}

function getPreviewType(entry: BrowserEntry) {
  const extension = entry.extension.toLowerCase();

  const imageExtensions = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".bmp",
    ".svg",
  ]);

  if (imageExtensions.has(extension)) {
    return "image";
  }

  if (extension === ".pdf") {
    return "pdf";
  }

  return "unsupported";
}

function buildFileUrl(
  folderId: string,
  filePath: string,
  action: "content" | "download",
) {
  const query = new URLSearchParams({
    path: filePath,
  });

  return (
    `${API_URL}/api/syncthing/folders/` +
    `${encodeURIComponent(folderId)}/files/` +
    `${action}?${query.toString()}`
  );
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

  const [selectedFolder, setSelectedFolder] =
    useState<SyncthingFolder | null>(null);

  const [browserData, setBrowserData] =
    useState<BrowserResponse | null>(null);

  const [browserLoading, setBrowserLoading] =
    useState(false);

  const [browserError, setBrowserError] =
    useState("");

  const [previewEntry, setPreviewEntry] =
    useState<BrowserEntry | null>(null);

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

  const [renameTarget, setRenameTarget] =
    useState<SyncthingFolder | null>(null);

  const [renameLabel, setRenameLabel] =
    useState("");

  const [renameLoading, setRenameLoading] =
    useState(false);

  const [renameError, setRenameError] =
    useState("");

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
      setError(
        requestError instanceof Error
          ? requestError.message
          : "An unknown error occurred.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadBrowser(
    folder: SyncthingFolder,
    path = "",
  ) {
    try {
      setSelectedFolder(folder);
      setBrowserLoading(true);
      setBrowserError("");
      setActiveMenuId(null);

      const query = new URLSearchParams();

      if (path) {
        query.set("path", path);
      }

      const suffix = query.toString()
        ? `?${query.toString()}`
        : "";

      const response = await fetch(
        `${API_URL}/api/syncthing/folders/${encodeURIComponent(
          folder.id,
        )}/files${suffix}`,
      );

      const data =
        await readResponseData(response);

      if (!response.ok) {
        throw new Error(
          data.detail ||
            "Could not load the folder contents.",
        );
      }

      setBrowserData(data);
    } catch (requestError) {
      setBrowserError(
        requestError instanceof Error
          ? requestError.message
          : "Could not load the folder contents.",
      );
    } finally {
      setBrowserLoading(false);
    }
  }

  function returnToMyFiles() {
    setSelectedFolder(null);
    setBrowserData(null);
    setBrowserError("");
    setPreviewEntry(null);
    setSearch("");
  }

  async function refreshCurrentView() {
    if (selectedFolder) {
      await loadBrowser(
        selectedFolder,
        browserData?.current_path || "",
      );
      return;
    }

    await loadData();
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

  useEffect(() => {
    function closeWithEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPreviewEntry(null);
      }
    }

    window.addEventListener(
      "keydown",
      closeWithEscape,
    );

    return () => {
      window.removeEventListener(
        "keydown",
        closeWithEscape,
      );
    };
  }, []);

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

  const filteredEntries = useMemo(() => {
    if (!browserData) {
      return [];
    }

    const searchValue =
      search.trim().toLowerCase();

    if (!searchValue) {
      return browserData.entries;
    }

    return browserData.entries.filter(
      (entry) =>
        entry.name
          .toLowerCase()
          .includes(searchValue),
    );
  }, [browserData, search]);

  function showSuccess(message: string) {
    setNotice(message);
  }

  function showError(message: string) {
    setNotice(`Error: ${message}`);
  }

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
      setCreateError(
        requestError instanceof Error
          ? requestError.message
          : "The folder could not be created.",
      );
    } finally {
      setCreateLoading(false);
    }
  }

  async function runFolderAction(
    folder: SyncthingFolder,
    action: FolderAction,
  ) {
    try {
      setActiveMenuId(null);
      setActionLoading(
        `${folder.id}-${action}`,
      );

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
            "The folder action failed.",
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
      showError(
        requestError instanceof Error
          ? requestError.message
          : "The folder action failed.",
      );
    } finally {
      setActionLoading(null);
    }
  }

  async function toggleFolderPaused(
    folder: SyncthingFolder,
  ) {
    const newPausedValue = !folder.paused;

    try {
      setActiveMenuId(null);
      setActionLoading(
        `${folder.id}-paused`,
      );

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
      showError(
        requestError instanceof Error
          ? requestError.message
          : "The folder state could not be changed.",
      );
    } finally {
      setActionLoading(null);
    }
  }

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
      setRenameError(
        requestError instanceof Error
          ? requestError.message
          : "The folder could not be renamed.",
      );
    } finally {
      setRenameLoading(false);
    }
  }

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
      setRemoveError(
        requestError instanceof Error
          ? requestError.message
          : "The folder could not be removed.",
      );
    } finally {
      setRemoveLoading(false);
    }
  }

  const previewType = previewEntry
    ? getPreviewType(previewEntry)
    : "unsupported";

  const previewContentUrl =
    previewEntry && selectedFolder
      ? buildFileUrl(
          selectedFolder.id,
          previewEntry.path,
          "content",
        )
      : "";

  const previewDownloadUrl =
    previewEntry && selectedFolder
      ? buildFileUrl(
          selectedFolder.id,
          previewEntry.path,
          "download",
        )
      : "";

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
            onClick={returnToMyFiles}
          >
            <span className="nav-icon">▣</span>
            My Files
          </button>

          <button className="nav-item" type="button">
            <span className="nav-icon">⇄</span>
            Sync Folders
          </button>

          <button className="nav-item" type="button">
            <span className="nav-icon">◉</span>
            Devices
          </button>

          <button className="nav-item" type="button">
            <span className="nav-icon">◷</span>
            Activity
          </button>

          <button className="nav-item" type="button">
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
              placeholder={
                selectedFolder
                  ? "Search in this folder"
                  : "Search in your files"
              }
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
              }}
            />
          </label>

          <button
            className="refresh-button"
            type="button"
            onClick={refreshCurrentView}
            aria-label="Refresh"
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

              <h1>
                {selectedFolder
                  ? selectedFolder.label
                  : "My Files"}
              </h1>

              <p>
                {selectedFolder
                  ? "Browse files stored in this sync folder."
                  : "Your Syncthing folders in one simple place."}
              </p>
            </div>

            {status?.connected && (
              <div className="connection-badge">
                <span className="connection-dot online" />
                Syncthing connected
              </div>
            )}
          </div>

          {!selectedFolder && (
            <>
              {loading && (
                <div className="state-card">
                  Loading your folders...
                </div>
              )}

              {error && (
                <div className="state-card error-card">
                  <strong>
                    Connection failed
                  </strong>

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
                    >
                      ▦
                    </button>
                  </div>

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
                          onClick={() => {
                            setSearch("");
                            loadBrowser(folder);
                          }}
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
                </>
              )}
            </>
          )}

          {selectedFolder && (
            <div className="browser-view">
              <div className="browser-toolbar">
                <button
                  className="browser-back-button"
                  type="button"
                  onClick={returnToMyFiles}
                >
                  ← My Files
                </button>

                {browserData && (
                  <nav className="breadcrumbs">
                    {browserData.breadcrumbs.map(
                      (breadcrumb, index) => (
                        <div
                          className="breadcrumb-part"
                          key={`${breadcrumb.path}-${index}`}
                        >
                          {index > 0 && (
                            <span>›</span>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              setSearch("");
                              loadBrowser(
                                selectedFolder,
                                breadcrumb.path,
                              );
                            }}
                          >
                            {breadcrumb.label}
                          </button>
                        </div>
                      ),
                    )}
                  </nav>
                )}
              </div>

              {browserLoading && (
                <div className="state-card">
                  Loading folder contents...
                </div>
              )}

              {browserError && (
                <div className="state-card error-card">
                  <strong>
                    Could not open folder
                  </strong>

                  <p>{browserError}</p>
                </div>
              )}

              {!browserLoading &&
                !browserError &&
                browserData && (
                  <>
                    <div className="section-heading">
                      <div>
                        <h2>Files</h2>

                        <span>
                          {filteredEntries.length} item
                          {filteredEntries.length === 1
                            ? ""
                            : "s"}
                        </span>
                      </div>

                      <button
                        className="view-button active"
                        type="button"
                      >
                        ▦
                      </button>
                    </div>

                    {filteredEntries.length > 0 ? (
                      <div className="browser-grid">
                        {filteredEntries.map(
                          (entry) => (
                            <article
                              className="browser-entry-card clickable"
                              key={entry.path}
                              onClick={() => {
                                if (
                                  entry.is_folder
                                ) {
                                  setSearch("");
                                  loadBrowser(
                                    selectedFolder,
                                    entry.path,
                                  );
                                } else {
                                  setPreviewEntry(
                                    entry,
                                  );
                                }
                              }}
                            >
                              <div
                                className={
                                  entry.is_folder
                                    ? "browser-entry-icon folder"
                                    : "browser-entry-icon file"
                                }
                              >
                                {entry.is_folder
                                  ? ""
                                  : getFileLabel(entry)}
                              </div>

                              <h3>{entry.name}</h3>

                              <p>
                                {entry.is_folder
                                  ? "Folder"
                                  : formatFileSize(
                                      entry.size_bytes,
                                    )}
                              </p>

                              <span className="entry-date">
                                {formatModifiedDate(
                                  entry.modified_at,
                                )}
                              </span>
                            </article>
                          ),
                        )}
                      </div>
                    ) : (
                      <div className="browser-empty">
                        <div className="empty-folder">
                          <span />
                        </div>

                        <h2>
                          This folder is empty
                        </h2>

                        <p>
                          Files placed here will appear
                          automatically.
                        </p>
                      </div>
                    )}
                  </>
                )}
            </div>
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

      {previewEntry && selectedFolder && (
        <div
          className="file-preview-backdrop"
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              setPreviewEntry(null);
            }
          }}
        >
          <section
            className="file-preview-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="preview-title"
          >
            <header className="file-preview-header">
              <div>
                <h2 id="preview-title">
                  {previewEntry.name}
                </h2>

                <p>
                  {formatFileSize(
                    previewEntry.size_bytes,
                  )}
                  {" · "}
                  {formatModifiedDate(
                    previewEntry.modified_at,
                  )}
                </p>
              </div>

              <div className="file-preview-actions">
                <a
                  className="preview-download-button"
                  href={previewDownloadUrl}
                >
                  Download
                </a>

                <button
                  className="preview-close-button"
                  type="button"
                  onClick={() => {
                    setPreviewEntry(null);
                  }}
                  aria-label="Close preview"
                >
                  ×
                </button>
              </div>
            </header>

            <div className="file-preview-body">
              {previewType === "image" && (
                <img
                  src={previewContentUrl}
                  alt={previewEntry.name}
                />
              )}

              {previewType === "pdf" && (
                <iframe
                  src={previewContentUrl}
                  title={previewEntry.name}
                />
              )}

              {previewType ===
                "unsupported" && (
                <div className="unsupported-preview">
                  <div className="unsupported-file-icon">
                    {getFileLabel(
                      previewEntry,
                    )}
                  </div>

                  <h3>
                    Preview is not available
                  </h3>

                  <p>
                    Download the file to open it
                    with an application on your
                    computer.
                  </p>

                  <a
                    className="preview-download-button large"
                    href={previewDownloadUrl}
                  >
                    Download file
                  </a>
                </div>
              )}
            </div>

            <footer className="file-preview-footer">
              <span>Location</span>
              <strong>{previewEntry.path}</strong>
            </footer>
          </section>
        </div>
      )}

      {isCreateOpen && (
        <div className="modal-backdrop">
          <section className="create-modal">
            <div className="modal-header">
              <div>
                <p>NEW SYNC FOLDER</p>
                <h2>Create a folder</h2>
              </div>

              <button
                className="modal-close"
                type="button"
                onClick={closeCreateDialog}
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
                <span>Location</span>

                <input
                  value={folderPath}
                  onChange={(event) => {
                    setFolderPath(
                      event.target.value,
                    );
                  }}
                  placeholder="C:/Users/admin/Projects"
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
                    Send from this device only
                  </option>

                  <option value="receiveonly">
                    Receive on this device only
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

      {renameTarget && (
        <div className="modal-backdrop">
          <section className="create-modal">
            <div className="modal-header">
              <div>
                <p>RENAME FOLDER</p>
                <h2>Change folder name</h2>
              </div>

              <button
                className="modal-close"
                type="button"
                onClick={closeRenameDialog}
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
                  value={renameLabel}
                  onChange={(event) => {
                    setRenameLabel(
                      event.target.value,
                    );
                  }}
                  autoFocus
                />
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

      {removeTarget && (
        <div className="modal-backdrop">
          <section className="create-modal">
            <div className="modal-header">
              <div>
                <p>REMOVE SYNC FOLDER</p>

                <h2>
                  Remove {removeTarget.label}?
                </h2>
              </div>

              <button
                className="modal-close"
                type="button"
                onClick={closeRemoveDialog}
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
                  This only removes the folder from
                  Syncthing and OpenUI.
                </p>
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