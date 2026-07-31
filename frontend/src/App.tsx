import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "./App.css";

type Page = "files" | "devices";
type FolderType = "sendreceive" | "sendonly" | "receiveonly";
type FolderAction = "open" | "scan";

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

type SyncthingDevice = {
  id: string;
  name: string;
  short_id: string;
  addresses: string[];
  connected: boolean;
  paused: boolean;
  connection_address: string;
  connection_type: string;
  client_version: string;
  is_local_network: boolean;
  in_bytes_total: number;
  out_bytes_total: number;
  connected_since: string;
  last_seen: string;
  introducer: boolean;
  auto_accept_folders: boolean;
  compression: string;
};

type LocalDevice = {
  id: string;
  short_id: string;
  message: string;
};

type DirectoryUploadFile = File & {
  webkitRelativePath?: string;
};

type ApiData = {
  detail?: unknown;
  message?: unknown;
  [key: string]: unknown;
};

type ModalShellProps = {
  eyebrow: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
};

const API_URL = (
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8000"
).replace(/\/+$/, "");

async function readJson(response: Response): Promise<ApiData> {
  return response.json().catch(() => ({} as ApiData));
}

function responseMessage(data: ApiData, fallback: string): string {
  if (typeof data.detail === "string" && data.detail.trim()) {
    return data.detail;
  }
  if (typeof data.message === "string" && data.message.trim()) {
    return data.message;
  }
  return fallback;
}

async function apiRequest<T>(
  path: string,
  init?: RequestInit,
  fallback = "The request failed.",
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, init);
  const data = await readJson(response);
  if (!response.ok) {
    throw new Error(responseMessage(data, fallback));
  }
  return data as unknown as T;
}

function formatBytes(value: number | null | undefined): string {
  const bytes = value ?? 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatDate(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fileLabel(entry: BrowserEntry): string {
  return entry.extension.replace(".", "").toUpperCase() || "FILE";
}

function previewType(entry: BrowserEntry): "image" | "pdf" | "unsupported" {
  const extension = entry.extension.toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"].includes(extension)) {
    return "image";
  }
  return extension === ".pdf" ? "pdf" : "unsupported";
}

function buildFileUrl(
  folderId: string,
  filePath: string,
  action: "content" | "download",
): string {
  const query = new URLSearchParams({ path: filePath });
  return `${API_URL}/api/syncthing/folders/${encodeURIComponent(folderId)}/files/${action}?${query.toString()}`;
}

function joinPath(...parts: string[]): string {
  return parts
    .flatMap((part) => part.replaceAll("\\", "/").split("/"))
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
}

function ModalShell({ eyebrow, title, onClose, children, wide = false }: ModalShellProps) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className={`create-modal${wide ? " modal-wide" : ""}`} role="dialog" aria-modal="true">
        <div className="modal-header">
          <div>
            <p>{eyebrow}</p>
            <h2>{title}</h2>
          </div>
          <button className="modal-close" type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}

function App() {
  const [page, setPage] = useState<Page>("files");
  const [status, setStatus] = useState<SyncthingStatus | null>(null);
  const [folders, setFolders] = useState<SyncthingFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const [selectedFolder, setSelectedFolder] = useState<SyncthingFolder | null>(null);
  const [browserData, setBrowserData] = useState<BrowserResponse | null>(null);
  const [browserLoading, setBrowserLoading] = useState(false);
  const [browserError, setBrowserError] = useState("");
  const [previewEntry, setPreviewEntry] = useState<BrowserEntry | null>(null);

  const [devices, setDevices] = useState<SyncthingDevice[]>([]);
  const [localDevice, setLocalDevice] = useState<LocalDevice | null>(null);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesError, setDevicesError] = useState("");

  const [isNewMenuOpen, setIsNewMenuOpen] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const folderUploadInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [folderUploadLoading, setFolderUploadLoading] = useState(false);
  const [folderUploadProgress, setFolderUploadProgress] = useState({ current: 0, total: 0 });

  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [folderLabel, setFolderLabel] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [folderType, setFolderType] = useState<FolderType>("sendreceive");
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState("");

  const [innerFolderOpen, setInnerFolderOpen] = useState(false);
  const [innerFolderName, setInnerFolderName] = useState("");

  const [folderRenameTarget, setFolderRenameTarget] = useState<SyncthingFolder | null>(null);
  const [folderRenameName, setFolderRenameName] = useState("");
  const [folderRemoveTarget, setFolderRemoveTarget] = useState<SyncthingFolder | null>(null);

  const [entryRenameTarget, setEntryRenameTarget] = useState<BrowserEntry | null>(null);
  const [entryRenameName, setEntryRenameName] = useState("");
  const [entryDeleteTarget, setEntryDeleteTarget] = useState<BrowserEntry | null>(null);

  const [addDeviceOpen, setAddDeviceOpen] = useState(false);
  const [deviceIdInput, setDeviceIdInput] = useState("");
  const [deviceNameInput, setDeviceNameInput] = useState("");
  const [deviceAddressesInput, setDeviceAddressesInput] = useState("dynamic");
  const [deviceCompression, setDeviceCompression] = useState("metadata");
  const [devicePausedInput, setDevicePausedInput] = useState(false);
  const [deviceIntroducerInput, setDeviceIntroducerInput] = useState(false);
  const [deviceAutoAcceptInput, setDeviceAutoAcceptInput] = useState(false);

  const [deviceRenameTarget, setDeviceRenameTarget] = useState<SyncthingDevice | null>(null);
  const [deviceRenameName, setDeviceRenameName] = useState("");
  const [deviceRemoveTarget, setDeviceRemoveTarget] = useState<SyncthingDevice | null>(null);

  function success(message: string) {
    setNotice(message);
  }

  function failure(message: string) {
    setNotice(`Error: ${message}`);
  }

  function clearFormState() {
    setFormError("");
    setFormLoading(false);
  }

  async function loadOverview() {
    try {
      setLoading(true);
      setError("");
      const [statusData, foldersData] = await Promise.all([
        apiRequest<SyncthingStatus>("/api/syncthing/status", undefined, "Could not load Syncthing status."),
        apiRequest<SyncthingFolder[]>("/api/syncthing/folders", undefined, "Could not load folders."),
      ]);
      setStatus(statusData);
      setFolders(foldersData);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load OpenUI.");
    } finally {
      setLoading(false);
    }
  }

  async function loadBrowser(folder: SyncthingFolder, path = "") {
    try {
      setSelectedFolder(folder);
      setBrowserLoading(true);
      setBrowserError("");
      setActiveMenu(null);
      setIsNewMenuOpen(false);
      setPreviewEntry(null);
      const query = path ? `?${new URLSearchParams({ path }).toString()}` : "";
      const data = await apiRequest<BrowserResponse>(
        `/api/syncthing/folders/${encodeURIComponent(folder.id)}/files${query}`,
        undefined,
        "Could not load the folder contents.",
      );
      setBrowserData(data);
    } catch (requestError) {
      setBrowserError(requestError instanceof Error ? requestError.message : "Could not load the folder contents.");
    } finally {
      setBrowserLoading(false);
    }
  }

  async function loadDevices() {
    try {
      setDevicesLoading(true);
      setDevicesError("");
      const [deviceData, localData] = await Promise.all([
        apiRequest<SyncthingDevice[]>("/api/syncthing/devices", undefined, "Could not load devices."),
        apiRequest<LocalDevice>("/api/syncthing/devices/local", undefined, "Could not load the local device ID."),
      ]);
      setDevices(deviceData);
      setLocalDevice(localData);
    } catch (requestError) {
      setDevicesError(requestError instanceof Error ? requestError.message : "Could not load devices.");
    } finally {
      setDevicesLoading(false);
    }
  }

  useEffect(() => {
    void loadOverview();
  }, []);

  useEffect(() => {
    const input = folderUploadInputRef.current;
    if (input) {
      input.setAttribute("webkitdirectory", "");
      input.setAttribute("directory", "");
    }
  }, []);

  useEffect(() => {
    const closeMenus = () => {
      setActiveMenu(null);
      setIsNewMenuOpen(false);
    };
    window.addEventListener("click", closeMenus);
    return () => window.removeEventListener("click", closeMenus);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setActiveMenu(null);
      setIsNewMenuOpen(false);
      setPreviewEntry(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  const filteredFolders = useMemo(() => {
    const value = search.trim().toLowerCase();
    if (!value) return folders;
    return folders.filter((folder) =>
      `${folder.label} ${folder.path}`.toLowerCase().includes(value),
    );
  }, [folders, search]);

  const filteredEntries = useMemo(() => {
    const entries = browserData?.entries ?? [];
    const value = search.trim().toLowerCase();
    if (!value) return entries;
    return entries.filter((entry) => entry.name.toLowerCase().includes(value));
  }, [browserData, search]);

  const filteredDevices = useMemo(() => {
    const value = search.trim().toLowerCase();
    if (!value) return devices;
    return devices.filter((device) =>
      `${device.name} ${device.id} ${device.connection_address}`.toLowerCase().includes(value),
    );
  }, [devices, search]);

  async function refreshCurrentView() {
    if (page === "devices") {
      await loadDevices();
      return;
    }
    if (selectedFolder) {
      await loadBrowser(selectedFolder, browserData?.current_path || "");
      return;
    }
    await loadOverview();
  }

  function openFilesPage() {
    setPage("files");
    setSelectedFolder(null);
    setBrowserData(null);
    setBrowserError("");
    setSearch("");
    setActiveMenu(null);
  }

  function openDevicesPage() {
    setPage("devices");
    setSelectedFolder(null);
    setBrowserData(null);
    setSearch("");
    setActiveMenu(null);
    void loadDevices();
  }

  function handleNewButton() {
    if (page === "devices") {
      clearFormState();
      setAddDeviceOpen(true);
      return;
    }
    if (!selectedFolder) {
      clearFormState();
      setCreateFolderOpen(true);
      return;
    }
    setIsNewMenuOpen((current) => !current);
  }

  async function createSyncFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = folderLabel.trim();
    const path = folderPath.trim();
    if (!label || !path) {
      setFormError("Enter a folder name and local path.");
      return;
    }
    try {
      setFormLoading(true);
      setFormError("");
      await apiRequest(
        "/api/syncthing/folders",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label, path, folder_type: folderType }),
        },
        "The folder could not be created.",
      );
      setCreateFolderOpen(false);
      setFolderLabel("");
      setFolderPath("");
      success(`${label} was created successfully.`);
      await loadOverview();
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : "The folder could not be created.");
    } finally {
      setFormLoading(false);
    }
  }

  async function runFolderAction(folder: SyncthingFolder, action: FolderAction) {
    try {
      setActiveMenu(null);
      setActionLoading(`${folder.id}-${action}`);
      await apiRequest(
        `/api/syncthing/folders/${encodeURIComponent(folder.id)}/${action}`,
        { method: "POST" },
        "The folder action failed.",
      );
      success(action === "open" ? `${folder.label} was opened.` : `Syncthing started scanning ${folder.label}.`);
    } catch (requestError) {
      failure(requestError instanceof Error ? requestError.message : "The folder action failed.");
    } finally {
      setActionLoading(null);
    }
  }

  async function toggleFolderPaused(folder: SyncthingFolder) {
    const paused = !folder.paused;
    try {
      setActiveMenu(null);
      setActionLoading(`${folder.id}-paused`);
      await apiRequest(
        `/api/syncthing/folders/${encodeURIComponent(folder.id)}/paused`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paused }),
        },
        "The folder state could not be changed.",
      );
      success(paused ? `${folder.label} was paused.` : `${folder.label} was resumed.`);
      await loadOverview();
    } catch (requestError) {
      failure(requestError instanceof Error ? requestError.message : "The folder state could not be changed.");
    } finally {
      setActionLoading(null);
    }
  }

  async function renameSyncFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!folderRenameTarget) return;
    const label = folderRenameName.trim();
    if (!label) {
      setFormError("Enter a folder name.");
      return;
    }
    try {
      setFormLoading(true);
      setFormError("");
      await apiRequest(
        `/api/syncthing/folders/${encodeURIComponent(folderRenameTarget.id)}/rename`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label }),
        },
        "The folder could not be renamed.",
      );
      setFolderRenameTarget(null);
      success(`Folder renamed to ${label}.`);
      await loadOverview();
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : "The folder could not be renamed.");
    } finally {
      setFormLoading(false);
    }
  }

  async function removeSyncFolder() {
    if (!folderRemoveTarget) return;
    try {
      setFormLoading(true);
      setFormError("");
      await apiRequest(
        `/api/syncthing/folders/${encodeURIComponent(folderRemoveTarget.id)}`,
        { method: "DELETE" },
        "The folder could not be removed.",
      );
      const name = folderRemoveTarget.label;
      setFolderRemoveTarget(null);
      success(`${name} was removed from Syncthing. Your files were not deleted.`);
      await loadOverview();
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : "The folder could not be removed.");
    } finally {
      setFormLoading(false);
    }
  }

  async function createInnerFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFolder) return;
    const name = innerFolderName.trim();
    if (!name) {
      setFormError("Enter a folder name.");
      return;
    }
    try {
      setFormLoading(true);
      setFormError("");
      await apiRequest(
        `/api/syncthing/folders/${encodeURIComponent(selectedFolder.id)}/files/folders`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parent_path: browserData?.current_path || "", name }),
        },
        "The folder could not be created.",
      );
      setInnerFolderOpen(false);
      setInnerFolderName("");
      success(`${name} was created successfully.`);
      await loadBrowser(selectedFolder, browserData?.current_path || "");
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : "The folder could not be created.");
    } finally {
      setFormLoading(false);
    }
  }

  async function uploadFile(file: File) {
    if (!selectedFolder) return;
    try {
      setUploadLoading(true);
      setIsNewMenuOpen(false);
      const body = new FormData();
      body.append("path", browserData?.current_path || "");
      body.append("overwrite", "false");
      body.append("file", file);
      const response = await fetch(
        `${API_URL}/api/syncthing/folders/${encodeURIComponent(selectedFolder.id)}/files/upload`,
        { method: "POST", body },
      );
      const data = await readJson(response);
      if (!response.ok) throw new Error(responseMessage(data, "The file could not be uploaded."));
      success(`${file.name} was uploaded successfully.`);
      await loadBrowser(selectedFolder, browserData?.current_path || "");
    } catch (requestError) {
      failure(requestError instanceof Error ? requestError.message : "The file could not be uploaded.");
    } finally {
      setUploadLoading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  }

  async function uploadFolder(fileList: FileList) {
    if (!selectedFolder || fileList.length === 0) return;
    const files = Array.from(fileList) as DirectoryUploadFile[];
    const basePath = browserData?.current_path || "";
    const items = files.map((file) => {
      const relativePath = (file.webkitRelativePath || file.name).replaceAll("\\", "/").replace(/^\/+/, "");
      const parts = relativePath.split("/").filter(Boolean);
      const fileName = parts.pop() || file.name;
      return { file, fileName, relativeDirectory: parts.join("/") };
    });
    const directories = new Set<string>();
    items.forEach((item) => {
      const parts = item.relativeDirectory.split("/").filter(Boolean);
      for (let index = 1; index <= parts.length; index += 1) {
        directories.add(parts.slice(0, index).join("/"));
      }
    });
    const orderedDirectories = [...directories].sort(
      (first, second) => first.split("/").length - second.split("/").length,
    );
    try {
      setFolderUploadLoading(true);
      setIsNewMenuOpen(false);
      setFolderUploadProgress({ current: 0, total: files.length });
      for (const relativeDirectory of orderedDirectories) {
        const parts = relativeDirectory.split("/");
        const name = parts.pop();
        if (!name) continue;
        const parentPath = joinPath(basePath, parts.join("/"));
        const response = await fetch(
          `${API_URL}/api/syncthing/folders/${encodeURIComponent(selectedFolder.id)}/files/folders`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ parent_path: parentPath, name }),
          },
        );
        if (!response.ok && response.status !== 409) {
          const data = await readJson(response);
          throw new Error(responseMessage(data, `Could not create ${relativeDirectory}.`));
        }
      }
      let completed = 0;
      let failed = 0;
      for (const item of items) {
        const body = new FormData();
        body.append("path", joinPath(basePath, item.relativeDirectory));
        body.append("overwrite", "false");
        body.append("file", item.file, item.fileName);
        try {
          const response = await fetch(
            `${API_URL}/api/syncthing/folders/${encodeURIComponent(selectedFolder.id)}/files/upload`,
            { method: "POST", body },
          );
          if (!response.ok) throw new Error("Upload failed.");
        } catch {
          failed += 1;
        }
        completed += 1;
        setFolderUploadProgress({ current: completed, total: files.length });
      }
      if (failed) failure(`${files.length - failed} files uploaded. ${failed} files failed.`);
      else success(`${files.length} files uploaded successfully.`);
      await loadBrowser(selectedFolder, basePath);
    } catch (requestError) {
      failure(requestError instanceof Error ? requestError.message : "The folder could not be uploaded.");
    } finally {
      setFolderUploadLoading(false);
      setFolderUploadProgress({ current: 0, total: 0 });
      if (folderUploadInputRef.current) folderUploadInputRef.current.value = "";
    }
  }

  async function renameBrowserEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFolder || !entryRenameTarget) return;
    const newName = entryRenameName.trim();
    if (!newName) {
      setFormError("Enter a new name.");
      return;
    }
    try {
      setFormLoading(true);
      setFormError("");
      await apiRequest(
        `/api/syncthing/folders/${encodeURIComponent(selectedFolder.id)}/files/rename`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: entryRenameTarget.path, new_name: newName }),
        },
        "The item could not be renamed.",
      );
      setEntryRenameTarget(null);
      success(`Item renamed to ${newName}.`);
      await loadBrowser(selectedFolder, browserData?.current_path || "");
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : "The item could not be renamed.");
    } finally {
      setFormLoading(false);
    }
  }

  async function deleteBrowserEntry() {
    if (!selectedFolder || !entryDeleteTarget) return;
    try {
      setFormLoading(true);
      setFormError("");
      const query = new URLSearchParams({ path: entryDeleteTarget.path });
      await apiRequest(
        `/api/syncthing/folders/${encodeURIComponent(selectedFolder.id)}/files?${query.toString()}`,
        { method: "DELETE" },
        "The item could not be deleted.",
      );
      const name = entryDeleteTarget.name;
      setEntryDeleteTarget(null);
      success(`${name} was deleted permanently.`);
      await loadBrowser(selectedFolder, browserData?.current_path || "");
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : "The item could not be deleted.");
    } finally {
      setFormLoading(false);
    }
  }

  async function copyLocalDeviceId() {
    if (!localDevice) return;
    try {
      await navigator.clipboard.writeText(localDevice.id);
      success("Local Device ID copied to the clipboard.");
    } catch {
      failure("Could not copy the Device ID. Select it and copy it manually.");
    }
  }

  async function addDevice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const deviceId = deviceIdInput.trim();
    const name = deviceNameInput.trim();
    if (!deviceId || !name) {
      setFormError("Enter the remote Device ID and a device name.");
      return;
    }
    const addresses = deviceAddressesInput
      .split(/\r?\n|,/)
      .map((address) => address.trim())
      .filter(Boolean);
    try {
      setFormLoading(true);
      setFormError("");
      await apiRequest(
        "/api/syncthing/devices",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            device_id: deviceId,
            name,
            addresses: addresses.length ? addresses : ["dynamic"],
            compression: deviceCompression,
            paused: devicePausedInput,
            introducer: deviceIntroducerInput,
            auto_accept_folders: deviceAutoAcceptInput,
          }),
        },
        "The device could not be added.",
      );
      setAddDeviceOpen(false);
      setDeviceIdInput("");
      setDeviceNameInput("");
      setDeviceAddressesInput("dynamic");
      setDeviceCompression("metadata");
      setDevicePausedInput(false);
      setDeviceIntroducerInput(false);
      setDeviceAutoAcceptInput(false);
      success(`${name} was added successfully.`);
      await loadDevices();
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : "The device could not be added.");
    } finally {
      setFormLoading(false);
    }
  }

  async function renameDevice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deviceRenameTarget) return;
    const name = deviceRenameName.trim();
    if (!name) {
      setFormError("Enter a device name.");
      return;
    }
    try {
      setFormLoading(true);
      setFormError("");
      await apiRequest(
        `/api/syncthing/devices/${encodeURIComponent(deviceRenameTarget.id)}/rename`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        },
        "The device could not be renamed.",
      );
      setDeviceRenameTarget(null);
      success(`Device renamed to ${name}.`);
      await loadDevices();
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : "The device could not be renamed.");
    } finally {
      setFormLoading(false);
    }
  }

  async function toggleDevicePaused(device: SyncthingDevice) {
    const paused = !device.paused;
    try {
      setActiveMenu(null);
      setActionLoading(`${device.id}-paused`);
      await apiRequest(
        `/api/syncthing/devices/${encodeURIComponent(device.id)}/paused`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paused }),
        },
        "The device state could not be changed.",
      );
      success(paused ? `${device.name} was paused.` : `${device.name} was resumed.`);
      await loadDevices();
    } catch (requestError) {
      failure(requestError instanceof Error ? requestError.message : "The device state could not be changed.");
    } finally {
      setActionLoading(null);
    }
  }

  async function removeDevice() {
    if (!deviceRemoveTarget) return;
    try {
      setFormLoading(true);
      setFormError("");
      await apiRequest(
        `/api/syncthing/devices/${encodeURIComponent(deviceRemoveTarget.id)}`,
        { method: "DELETE" },
        "The device could not be removed.",
      );
      const name = deviceRemoveTarget.name;
      setDeviceRemoveTarget(null);
      success(`${name} was removed from Syncthing.`);
      await loadDevices();
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : "The device could not be removed.");
    } finally {
      setFormLoading(false);
    }
  }

  const isUploading = uploadLoading || folderUploadLoading;
  const currentPreviewType = previewEntry ? previewType(previewEntry) : "unsupported";
  const previewContentUrl = previewEntry && selectedFolder
    ? buildFileUrl(selectedFolder.id, previewEntry.path, "content")
    : "";
  const previewDownloadUrl = previewEntry && selectedFolder
    ? buildFileUrl(selectedFolder.id, previewEntry.path, "download")
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

        <div className="new-menu-wrap" onClick={(event) => event.stopPropagation()}>
          <button className="new-button" type="button" onClick={handleNewButton} disabled={isUploading}>
            <span>＋</span>
            {folderUploadLoading
              ? `Uploading ${folderUploadProgress.current}/${folderUploadProgress.total}`
              : uploadLoading
                ? "Uploading..."
                : page === "devices"
                  ? "Add device"
                  : "New"}
          </button>

          {page === "files" && selectedFolder && isNewMenuOpen && (
            <div className="new-file-menu">
              <button
                type="button"
                onClick={() => {
                  clearFormState();
                  setIsNewMenuOpen(false);
                  setInnerFolderOpen(true);
                }}
              >
                <span>▣</span> New folder
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsNewMenuOpen(false);
                  uploadInputRef.current?.click();
                }}
              >
                <span>↑</span> Upload file
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsNewMenuOpen(false);
                  folderUploadInputRef.current?.click();
                }}
              >
                <span>⇧</span> Upload folder
              </button>
            </div>
          )}

          <input
            ref={uploadInputRef}
            className="hidden-file-input"
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadFile(file);
            }}
          />
          <input
            ref={folderUploadInputRef}
            className="hidden-file-input"
            type="file"
            multiple
            onChange={(event) => {
              if (event.target.files?.length) void uploadFolder(event.target.files);
            }}
          />
        </div>

        <nav className="navigation">
          <button className={`nav-item${page === "files" ? " active" : ""}`} type="button" onClick={openFilesPage}>
            <span className="nav-icon">▣</span> My Files
          </button>
          <button className="nav-item" type="button" onClick={openFilesPage}>
            <span className="nav-icon">⇄</span> Sync Folders
          </button>
          <button className={`nav-item${page === "devices" ? " active" : ""}`} type="button" onClick={openDevicesPage}>
            <span className="nav-icon">◉</span> Devices
          </button>
          <button className="nav-item" type="button">
            <span className="nav-icon">◷</span> Activity
          </button>
          <button className="nav-item" type="button">
            <span className="nav-icon">⚙</span> Settings
          </button>
        </nav>

        <div className="sidebar-status">
          <span className={`connection-dot${status?.connected ? " online" : ""}`} />
          <div>
            <strong>{status?.connected ? "Connected" : "Offline"}</strong>
            <span>Syncthing {status?.syncthing_version || ""}</span>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <label className="search-box">
            <span>⌕</span>
            <input
              type="search"
              placeholder={page === "devices" ? "Search devices" : selectedFolder ? "Search in this folder" : "Search in your files"}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <button className="refresh-button" type="button" onClick={() => void refreshCurrentView()} aria-label="Refresh" title="Refresh">
            ↻
          </button>
          <div className="user-avatar">AM</div>
        </header>

        <section className="content">
          {page === "devices" ? (
            <>
              <div className="page-heading">
                <div>
                  <p className="page-eyebrow">OPENUI HUB</p>
                  <h1>Devices</h1>
                  <p>Connect and manage trusted Syncthing devices.</p>
                </div>
                {status?.connected && (
                  <div className="connection-badge">
                    <span className="connection-dot online" /> Syncthing connected
                  </div>
                )}
              </div>

              {localDevice && (
                <section className="local-device-card">
                  <div className="local-device-copy">
                    <div className="device-symbol">◎</div>
                    <div>
                      <span className="device-kicker">THIS DEVICE</span>
                      <h2>Share your Device ID</h2>
                      <p>Give this ID to another trusted device to connect it to OpenUI.</p>
                    </div>
                  </div>
                  <div className="device-id-box">
                    <code>{localDevice.id}</code>
                    <button className="copy-device-button" type="button" onClick={() => void copyLocalDeviceId()}>
                      Copy ID
                    </button>
                  </div>
                </section>
              )}

              <div className="section-heading">
                <div>
                  <h2>Remote Devices</h2>
                  <span>{filteredDevices.length} device{filteredDevices.length === 1 ? "" : "s"}</span>
                </div>
                <button
                  className="primary-button compact-button"
                  type="button"
                  onClick={() => {
                    clearFormState();
                    setAddDeviceOpen(true);
                  }}
                >
                  ＋ Add device
                </button>
              </div>

              {devicesLoading && <div className="state-card">Loading devices...</div>}
              {devicesError && (
                <div className="state-card error-card">
                  <strong>Could not load devices</strong>
                  <p>{devicesError}</p>
                  <button type="button" onClick={() => void loadDevices()}>Try again</button>
                </div>
              )}
              {!devicesLoading && !devicesError && filteredDevices.length === 0 && (
                <div className="device-empty-state">
                  <div className="device-empty-icon">◎</div>
                  <h2>No remote devices yet</h2>
                  <p>Add a trusted device using its Syncthing Device ID.</p>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => {
                      clearFormState();
                      setAddDeviceOpen(true);
                    }}
                  >
                    Add your first device
                  </button>
                </div>
              )}
              {!devicesLoading && !devicesError && filteredDevices.length > 0 && (
                <div className="device-grid">
                  {filteredDevices.map((device) => {
                    const menuKey = `device-${device.id}`;
                    const stateLabel = device.paused ? "Paused" : device.connected ? "Connected" : "Offline";
                    return (
                      <article className={`device-card${device.paused ? " paused-device" : ""}`} key={device.id}>
                        <div className="device-card-header">
                          <div className="device-title-row">
                            <div className={`device-symbol${device.connected && !device.paused ? " connected" : ""}`}>◎</div>
                            <div>
                              <h3>{device.name}</h3>
                              <span className={`device-state ${stateLabel.toLowerCase()}`}>{stateLabel}</span>
                            </div>
                          </div>
                          <div className="folder-menu-wrap" onClick={(event) => event.stopPropagation()}>
                            <button
                              className="more-button"
                              type="button"
                              aria-label={`Options for ${device.name}`}
                              onClick={() => setActiveMenu(activeMenu === menuKey ? null : menuKey)}
                            >
                              •••
                            </button>
                            {activeMenu === menuKey && (
                              <div className="folder-menu device-menu">
                                <button type="button" onClick={() => void toggleDevicePaused(device)} disabled={actionLoading !== null}>
                                  <span>{device.paused ? "▶" : "Ⅱ"}</span> {device.paused ? "Resume device" : "Pause device"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    clearFormState();
                                    setActiveMenu(null);
                                    setDeviceRenameTarget(device);
                                    setDeviceRenameName(device.name);
                                  }}
                                >
                                  <span>✎</span> Rename
                                </button>
                                <button
                                  className="menu-danger"
                                  type="button"
                                  onClick={() => {
                                    clearFormState();
                                    setActiveMenu(null);
                                    setDeviceRemoveTarget(device);
                                  }}
                                >
                                  <span>×</span> Remove device
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="device-id-short">
                          <span>Device ID</span>
                          <code>{device.id}</code>
                        </div>

                        <div className="device-details-grid">
                          <div>
                            <span>Connection</span>
                            <strong>{device.connection_address || "Not connected"}</strong>
                          </div>
                          <div>
                            <span>Version</span>
                            <strong>{device.client_version || "—"}</strong>
                          </div>
                          <div>
                            <span>Received</span>
                            <strong>{formatBytes(device.in_bytes_total)}</strong>
                          </div>
                          <div>
                            <span>Sent</span>
                            <strong>{formatBytes(device.out_bytes_total)}</strong>
                          </div>
                        </div>

                        <div className="device-addresses">
                          <span>Addresses</span>
                          <p>{device.addresses.length ? device.addresses.join(", ") : "dynamic"}</p>
                        </div>

                        <div className="device-card-footer">
                          <span>{device.is_local_network ? "Local network" : device.connection_type || "Remote"}</span>
                          <span>{device.connected ? `Connected since ${formatDate(device.connected_since)}` : `Last seen ${formatDate(device.last_seen)}`}</span>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <p className="page-eyebrow">OPENUI HUB</p>
                  <h1>{selectedFolder ? selectedFolder.label : "My Files"}</h1>
                  <p>{selectedFolder ? "Browse files stored in this sync folder." : "Your Syncthing folders in one simple place."}</p>
                </div>
                {status?.connected && (
                  <div className="connection-badge">
                    <span className="connection-dot online" /> Syncthing connected
                  </div>
                )}
              </div>

              {!selectedFolder ? (
                <>
                  {loading && <div className="state-card">Loading your folders...</div>}
                  {error && (
                    <div className="state-card error-card">
                      <strong>Connection failed</strong>
                      <p>{error}</p>
                      <button type="button" onClick={() => void loadOverview()}>Try again</button>
                    </div>
                  )}
                  {!loading && !error && (
                    <>
                      <div className="section-heading">
                        <div>
                          <h2>Folders</h2>
                          <span>{filteredFolders.length} folder{filteredFolders.length === 1 ? "" : "s"}</span>
                        </div>
                        <button className="view-button active" type="button" title="Grid view">▦</button>
                      </div>
                      {filteredFolders.length ? (
                        <div className="folder-grid">
                          {filteredFolders.map((folder) => {
                            const menuKey = `folder-${folder.id}`;
                            return (
                              <article
                                className={`folder-card${folder.paused ? " paused-folder" : ""}`}
                                key={folder.id}
                                onClick={() => {
                                  setSearch("");
                                  void loadBrowser(folder);
                                }}
                              >
                                <div className="folder-card-top">
                                  <div className="folder-icon"><span /></div>
                                  <div className="folder-menu-wrap" onClick={(event) => event.stopPropagation()}>
                                    <button className="more-button" type="button" onClick={() => setActiveMenu(activeMenu === menuKey ? null : menuKey)}>•••</button>
                                    {activeMenu === menuKey && (
                                      <div className="folder-menu">
                                        <button type="button" onClick={() => void runFolderAction(folder, "open")}><span>↗</span> Open folder</button>
                                        <button type="button" onClick={() => void runFolderAction(folder, "scan")} disabled={folder.paused}><span>↻</span> Rescan</button>
                                        <button type="button" onClick={() => void toggleFolderPaused(folder)} disabled={actionLoading !== null}>
                                          <span>{folder.paused ? "▶" : "Ⅱ"}</span> {folder.paused ? "Resume sync" : "Pause sync"}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            clearFormState();
                                            setActiveMenu(null);
                                            setFolderRenameTarget(folder);
                                            setFolderRenameName(folder.label);
                                          }}
                                        >
                                          <span>✎</span> Rename
                                        </button>
                                        <button
                                          className="menu-danger"
                                          type="button"
                                          onClick={() => {
                                            clearFormState();
                                            setActiveMenu(null);
                                            setFolderRemoveTarget(folder);
                                          }}
                                        >
                                          <span>×</span> Remove from Syncthing
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <h3>{folder.label}</h3>
                                <p className="folder-path">{folder.path}</p>
                                <div className="folder-meta">
                                  <span className={`folder-status${folder.paused ? " paused" : ""}`}>{folder.paused ? "Sync paused" : "Sync active"}</span>
                                  <span>{folder.device_count} device{folder.device_count === 1 ? "" : "s"}</span>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="empty-state">
                          <div className="empty-folder"><span /></div>
                          <h2>No folders found</h2>
                          <p>Create a new sync folder to begin.</p>
                        </div>
                      )}
                      <section className="quick-info">
                        <article><span>Syncthing</span><strong>{status?.syncthing_version || "—"}</strong></article>
                        <article><span>System</span><strong>{status ? `${status.operating_system} · ${status.architecture}` : "—"}</strong></article>
                        <article><span>Device</span><strong>{status?.device_id ? `${status.device_id.slice(0, 7)}…` : "—"}</strong></article>
                      </section>
                    </>
                  )}
                </>
              ) : (
                <div className="browser-view">
                  <div className="browser-toolbar">
                    <button className="browser-back-button" type="button" onClick={openFilesPage}>← My Files</button>
                    {browserData && (
                      <nav className="breadcrumbs">
                        {browserData.breadcrumbs.map((breadcrumb, index) => (
                          <div className="breadcrumb-part" key={`${breadcrumb.path}-${index}`}>
                            {index > 0 && <span>›</span>}
                            <button
                              type="button"
                              onClick={() => {
                                setSearch("");
                                void loadBrowser(selectedFolder, breadcrumb.path);
                              }}
                            >
                              {breadcrumb.label}
                            </button>
                          </div>
                        ))}
                      </nav>
                    )}
                  </div>
                  {browserLoading && <div className="state-card">Loading folder contents...</div>}
                  {browserError && (
                    <div className="state-card error-card">
                      <strong>Could not open folder</strong>
                      <p>{browserError}</p>
                      <button type="button" onClick={() => void loadBrowser(selectedFolder, browserData?.current_path || "")}>Try again</button>
                    </div>
                  )}
                  {!browserLoading && !browserError && browserData && (
                    <>
                      <div className="section-heading">
                        <div><h2>Files</h2><span>{filteredEntries.length} item{filteredEntries.length === 1 ? "" : "s"}</span></div>
                        <button className="view-button active" type="button" title="Grid view">▦</button>
                      </div>
                      {filteredEntries.length ? (
                        <div className="browser-grid">
                          {filteredEntries.map((entry) => {
                            const menuKey = `entry-${entry.path}`;
                            return (
                              <article
                                className="browser-entry-card clickable"
                                key={entry.path}
                                onClick={() => {
                                  if (entry.is_folder) {
                                    setSearch("");
                                    void loadBrowser(selectedFolder, entry.path);
                                  } else setPreviewEntry(entry);
                                }}
                              >
                                <div className="folder-card-top">
                                  <div className={`browser-entry-icon ${entry.is_folder ? "folder" : "file"}`}>
                                    {entry.is_folder ? "" : fileLabel(entry)}
                                  </div>
                                  <div className="folder-menu-wrap" onClick={(event) => event.stopPropagation()}>
                                    <button className="more-button" type="button" onClick={() => setActiveMenu(activeMenu === menuKey ? null : menuKey)}>•••</button>
                                    {activeMenu === menuKey && (
                                      <div className="folder-menu">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            clearFormState();
                                            setActiveMenu(null);
                                            setEntryRenameTarget(entry);
                                            setEntryRenameName(entry.name);
                                          }}
                                        >
                                          <span>✎</span> Rename
                                        </button>
                                        <button
                                          className="menu-danger"
                                          type="button"
                                          onClick={() => {
                                            clearFormState();
                                            setActiveMenu(null);
                                            setEntryDeleteTarget(entry);
                                          }}
                                        >
                                          <span>×</span> Delete permanently
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <h3>{entry.name}</h3>
                                <p>{entry.is_folder ? "Folder" : formatBytes(entry.size_bytes)}</p>
                                <span className="entry-date">{formatDate(entry.modified_at)}</span>
                              </article>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="browser-empty">
                          <div className="empty-folder"><span /></div>
                          <h2>This folder is empty</h2>
                          <p>Create a folder or upload files using the New button.</p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </main>

      {notice && <div className={`app-notice${notice.startsWith("Error:") ? " error" : ""}`}>{notice}</div>}

      {previewEntry && selectedFolder && (
        <div className="file-preview-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setPreviewEntry(null)}>
          <section className="file-preview-modal" role="dialog" aria-modal="true">
            <header className="file-preview-header">
              <div><h2>{previewEntry.name}</h2><p>{formatBytes(previewEntry.size_bytes)} · {formatDate(previewEntry.modified_at)}</p></div>
              <div className="file-preview-actions">
                <a className="preview-download-button" href={previewDownloadUrl}>Download</a>
                <button className="preview-close-button" type="button" onClick={() => setPreviewEntry(null)}>×</button>
              </div>
            </header>
            <div className="file-preview-body">
              {currentPreviewType === "image" && <img src={previewContentUrl} alt={previewEntry.name} />}
              {currentPreviewType === "pdf" && <iframe src={previewContentUrl} title={previewEntry.name} />}
              {currentPreviewType === "unsupported" && (
                <div className="unsupported-preview">
                  <div className="unsupported-file-icon">{fileLabel(previewEntry)}</div>
                  <h3>Preview is not available</h3>
                  <p>Download the file to open it on your computer.</p>
                  <a className="preview-download-button large" href={previewDownloadUrl}>Download file</a>
                </div>
              )}
            </div>
            <footer className="file-preview-footer"><span>Location</span><strong>{previewEntry.path}</strong></footer>
          </section>
        </div>
      )}

      {createFolderOpen && (
        <ModalShell eyebrow="NEW SYNC FOLDER" title="Create a sync folder" onClose={() => !formLoading && setCreateFolderOpen(false)}>
          <form className="create-form" onSubmit={createSyncFolder}>
            <label className="form-field"><span>Folder name</span><input value={folderLabel} onChange={(event) => setFolderLabel(event.target.value)} placeholder="Example: Projects" autoFocus /></label>
            <label className="form-field"><span>Location on this computer</span><input value={folderPath} onChange={(event) => setFolderPath(event.target.value)} placeholder="C:/Users/admin/Projects" /></label>
            <label className="form-field"><span>Sync mode</span><select value={folderType} onChange={(event) => setFolderType(event.target.value as FolderType)}><option value="sendreceive">Keep files synchronized everywhere</option><option value="sendonly">Send from this device only</option><option value="receiveonly">Receive on this device only</option></select></label>
            {formError && <div className="form-error">{formError}</div>}
            <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setCreateFolderOpen(false)} disabled={formLoading}>Cancel</button><button className="primary-button" type="submit" disabled={formLoading}>{formLoading ? "Creating..." : "Create folder"}</button></div>
          </form>
        </ModalShell>
      )}

      {innerFolderOpen && selectedFolder && (
        <ModalShell eyebrow="NEW FOLDER" title="Create a folder" onClose={() => !formLoading && setInnerFolderOpen(false)}>
          <form className="create-form" onSubmit={createInnerFolder}>
            <label className="form-field"><span>Folder name</span><input value={innerFolderName} onChange={(event) => setInnerFolderName(event.target.value)} placeholder="Example: Documents" autoFocus /><small>The folder will be created in {browserData?.current_path || selectedFolder.label}.</small></label>
            {formError && <div className="form-error">{formError}</div>}
            <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setInnerFolderOpen(false)} disabled={formLoading}>Cancel</button><button className="primary-button" type="submit" disabled={formLoading}>{formLoading ? "Creating..." : "Create folder"}</button></div>
          </form>
        </ModalShell>
      )}

      {folderRenameTarget && (
        <ModalShell eyebrow="RENAME SYNC FOLDER" title="Change folder name" onClose={() => !formLoading && setFolderRenameTarget(null)}>
          <form className="create-form" onSubmit={renameSyncFolder}>
            <label className="form-field"><span>Folder name</span><input value={folderRenameName} onChange={(event) => setFolderRenameName(event.target.value)} autoFocus /></label>
            {formError && <div className="form-error">{formError}</div>}
            <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setFolderRenameTarget(null)} disabled={formLoading}>Cancel</button><button className="primary-button" type="submit" disabled={formLoading}>{formLoading ? "Renaming..." : "Save name"}</button></div>
          </form>
        </ModalShell>
      )}

      {folderRemoveTarget && (
        <ModalShell eyebrow="REMOVE SYNC FOLDER" title={`Remove ${folderRemoveTarget.label}?`} onClose={() => !formLoading && setFolderRemoveTarget(null)}>
          <div className="create-form">
            <div className="remove-warning"><strong>Your files will not be deleted.</strong><p>This only removes the folder from Syncthing and OpenUI.</p></div>
            <div className="remove-path"><span>Files will remain at:</span><strong>{folderRemoveTarget.path}</strong></div>
            {formError && <div className="form-error">{formError}</div>}
            <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setFolderRemoveTarget(null)} disabled={formLoading}>Cancel</button><button className="danger-button" type="button" onClick={() => void removeSyncFolder()} disabled={formLoading}>{formLoading ? "Removing..." : "Remove from Syncthing"}</button></div>
          </div>
        </ModalShell>
      )}

      {entryRenameTarget && (
        <ModalShell eyebrow={entryRenameTarget.is_folder ? "RENAME FOLDER" : "RENAME FILE"} title="Change item name" onClose={() => !formLoading && setEntryRenameTarget(null)}>
          <form className="create-form" onSubmit={renameBrowserEntry}>
            <label className="form-field"><span>New name</span><input value={entryRenameName} onChange={(event) => setEntryRenameName(event.target.value)} autoFocus /><small>Current location: {entryRenameTarget.path}</small></label>
            {formError && <div className="form-error">{formError}</div>}
            <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setEntryRenameTarget(null)} disabled={formLoading}>Cancel</button><button className="primary-button" type="submit" disabled={formLoading}>{formLoading ? "Renaming..." : "Save name"}</button></div>
          </form>
        </ModalShell>
      )}

      {entryDeleteTarget && (
        <ModalShell eyebrow={entryDeleteTarget.is_folder ? "DELETE FOLDER" : "DELETE FILE"} title={`Delete ${entryDeleteTarget.name}?`} onClose={() => !formLoading && setEntryDeleteTarget(null)}>
          <div className="create-form">
            <div className="remove-warning"><strong>This action is permanent.</strong><p>{entryDeleteTarget.is_folder ? "The folder and everything inside it will be deleted from synchronized devices." : "The file will be deleted from synchronized devices."}</p></div>
            <div className="remove-path"><span>Item location:</span><strong>{entryDeleteTarget.path}</strong></div>
            {formError && <div className="form-error">{formError}</div>}
            <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setEntryDeleteTarget(null)} disabled={formLoading}>Cancel</button><button className="danger-button" type="button" onClick={() => void deleteBrowserEntry()} disabled={formLoading}>{formLoading ? "Deleting..." : "Delete permanently"}</button></div>
          </div>
        </ModalShell>
      )}

      {addDeviceOpen && (
        <ModalShell eyebrow="NEW REMOTE DEVICE" title="Add a Syncthing device" onClose={() => !formLoading && setAddDeviceOpen(false)} wide>
          <form className="create-form" onSubmit={addDevice}>
            <div className="device-form-grid">
              <label className="form-field"><span>Device name</span><input value={deviceNameInput} onChange={(event) => setDeviceNameInput(event.target.value)} placeholder="Example: Office Laptop" autoFocus /></label>
              <label className="form-field"><span>Compression</span><select value={deviceCompression} onChange={(event) => setDeviceCompression(event.target.value)}><option value="metadata">Metadata only</option><option value="always">Always</option><option value="never">Never</option></select></label>
            </div>
            <label className="form-field"><span>Remote Device ID</span><textarea className="device-id-input" value={deviceIdInput} onChange={(event) => setDeviceIdInput(event.target.value)} placeholder="XXXXXXX-XXXXXXX-..." rows={3} /><small>Paste the Device ID shown on the other Syncthing device.</small></label>
            <label className="form-field"><span>Addresses</span><textarea value={deviceAddressesInput} onChange={(event) => setDeviceAddressesInput(event.target.value)} rows={3} placeholder="dynamic" /><small>Use dynamic, or enter one address per line.</small></label>
            <div className="device-checkbox-grid">
              <label className="checkbox-field"><input type="checkbox" checked={devicePausedInput} onChange={(event) => setDevicePausedInput(event.target.checked)} /><span>Start paused</span></label>
              <label className="checkbox-field"><input type="checkbox" checked={deviceIntroducerInput} onChange={(event) => setDeviceIntroducerInput(event.target.checked)} /><span>Introducer</span></label>
              <label className="checkbox-field"><input type="checkbox" checked={deviceAutoAcceptInput} onChange={(event) => setDeviceAutoAcceptInput(event.target.checked)} /><span>Automatically accept folders</span></label>
            </div>
            {formError && <div className="form-error">{formError}</div>}
            <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setAddDeviceOpen(false)} disabled={formLoading}>Cancel</button><button className="primary-button" type="submit" disabled={formLoading}>{formLoading ? "Adding..." : "Add device"}</button></div>
          </form>
        </ModalShell>
      )}

      {deviceRenameTarget && (
        <ModalShell eyebrow="RENAME DEVICE" title="Change device name" onClose={() => !formLoading && setDeviceRenameTarget(null)}>
          <form className="create-form" onSubmit={renameDevice}>
            <label className="form-field"><span>Device name</span><input value={deviceRenameName} onChange={(event) => setDeviceRenameName(event.target.value)} autoFocus /><small>{deviceRenameTarget.short_id}</small></label>
            {formError && <div className="form-error">{formError}</div>}
            <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setDeviceRenameTarget(null)} disabled={formLoading}>Cancel</button><button className="primary-button" type="submit" disabled={formLoading}>{formLoading ? "Renaming..." : "Save name"}</button></div>
          </form>
        </ModalShell>
      )}

      {deviceRemoveTarget && (
        <ModalShell eyebrow="REMOVE DEVICE" title={`Remove ${deviceRemoveTarget.name}?`} onClose={() => !formLoading && setDeviceRemoveTarget(null)}>
          <div className="create-form">
            <div className="remove-warning"><strong>This device will lose access.</strong><p>The remote device will be removed from Syncthing. Local files are not deleted by this action.</p></div>
            <div className="remove-path"><span>Device ID:</span><strong>{deviceRemoveTarget.id}</strong></div>
            {formError && <div className="form-error">{formError}</div>}
            <div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setDeviceRemoveTarget(null)} disabled={formLoading}>Cancel</button><button className="danger-button" type="button" onClick={() => void removeDevice()} disabled={formLoading}>{formLoading ? "Removing..." : "Remove device"}</button></div>
          </div>
        </ModalShell>
      )}
    </div>
  );
}

export default App;