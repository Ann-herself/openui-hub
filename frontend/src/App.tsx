import { useEffect, useMemo, useState } from "react";
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

function App() {
  const [status, setStatus] = useState<SyncthingStatus | null>(null);
  const [folders, setFolders] = useState<SyncthingFolder[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadData() {
    try {
      setLoading(true);
      setError("");

      const [statusResponse, foldersResponse] = await Promise.all([
        fetch("http://127.0.0.1:8000/api/syncthing/status"),
        fetch("http://127.0.0.1:8000/api/syncthing/folders"),
      ]);

      const statusData = await statusResponse.json();
      const foldersData = await foldersResponse.json();

      if (!statusResponse.ok) {
        throw new Error(
          statusData.detail || "Could not load Syncthing status",
        );
      }

      if (!foldersResponse.ok) {
        throw new Error(
          foldersData.detail || "Could not load folders",
        );
      }

      setStatus(statusData);
      setFolders(foldersData);
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : "An unknown error occurred";

      setError(message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const filteredFolders = useMemo(() => {
    const searchValue = search.trim().toLowerCase();

    if (!searchValue) {
      return folders;
    }

    return folders.filter((folder) => {
      return (
        folder.label.toLowerCase().includes(searchValue) ||
        folder.path.toLowerCase().includes(searchValue)
      );
    });
  }, [folders, search]);

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
          onClick={() => {
            window.alert(
              "Creating folders from OpenUI will be added next.",
            );
          }}
        >
          <span>＋</span>
          New
        </button>

        <nav className="navigation">
          <button className="nav-item active" type="button">
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
              {status?.connected ? "Connected" : "Offline"}
            </strong>
            <span>Syncthing {status?.syncthing_version}</span>
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
              <p className="page-eyebrow">OPENUI HUB</p>
              <h1>My Files</h1>
              <p>
                Your Syncthing folders in one simple place.
              </p>
            </div>

            <div className="connection-badge">
              <span className="connection-dot online" />
              Syncthing connected
            </div>
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
              <button type="button" onClick={loadData}>
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
                    {filteredFolders.length === 1 ? "" : "s"}
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
                  {filteredFolders.map((folder) => (
                    <article
                      className="folder-card"
                      key={folder.id}
                    >
                      <div className="folder-card-top">
                        <div className="folder-icon">
                          <span />
                        </div>

                        <button
                          className="more-button"
                          type="button"
                          title="Folder options"
                        >
                          •••
                        </button>
                      </div>

                      <h3>{folder.label}</h3>
                      <p className="folder-path">
                        {folder.path}
                      </p>

                      <div className="folder-meta">
                        <span>
                          {folder.paused
                            ? "Paused"
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
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-folder">
                    <span />
                  </div>

                  <h2>No folders found</h2>

                  <p>
                    Try a different search or add a folder
                    inside Syncthing.
                  </p>
                </div>
              )}

              <section className="quick-info">
                <article>
                  <span>Syncthing</span>
                  <strong>
                    {status?.syncthing_version || "—"}
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
                      ? `${status.device_id.slice(0, 7)}…`
                      : "—"}
                  </strong>
                </article>
              </section>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;