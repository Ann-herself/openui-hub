import {
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
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

type DirectoryUploadFile = File & {
  webkitRelativePath?: string;
};

type ApiResponseData = {
  detail?: unknown;
  message?: unknown;
  [key: string]: unknown;
};

const API_URL = (
  import.meta.env.VITE_API_URL ||
  "http://127.0.0.1:8000"
).replace(/\/+$/, "");

async function readResponseData(
  response: Response,
): Promise<ApiResponseData> {
  return response
    .json()
    .catch(() => ({} as ApiResponseData));
}

function getResponseMessage(
  data: ApiResponseData,
  fallback: string,
) {
  if (
    typeof data.detail === "string" &&
    data.detail.trim()
  ) {
    return data.detail;
  }

  if (
    typeof data.message === "string" &&
    data.message.trim()
  ) {
    return data.message;
  }

  return fallback;
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

function getPreviewType(
  entry: BrowserEntry,
): "image" | "pdf" | "unsupported" {
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

function joinBrowserPath(...parts: string[]) {
  return parts
    .flatMap((part) =>
      part.replaceAll("\\", "/").split("/"),
    )
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
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

  const [
    activeEntryMenuPath,
    setActiveEntryMenuPath,
  ] = useState<string | null>(null);

  const [actionLoading, setActionLoading] =
    useState<string | null>(null);

  const [notice, setNotice] = useState("");

  /*
   * File browser
   */

  const [selectedFolder, setSelectedFolder] =
    useState<SyncthingFolder | null>(null);

  const [browserData, setBrowserData] =
    useState<BrowserResponse | null>(null);

  const [browserLoading, setBrowserLoading] =
    useState(false);

  const [browserError, setBrowserError] =
    useState("");

  /*
   * File preview
   */

  const [previewEntry, setPreviewEntry] =
    useState<BrowserEntry | null>(null);

  /*
   * New menu and uploads
   */

  const [isNewMenuOpen, setIsNewMenuOpen] =
    useState(false);

  const [
    isInnerFolderOpen,
    setIsInnerFolderOpen,
  ] = useState(false);

  const [innerFolderName, setInnerFolderName] =
    useState("");

  const [
    innerFolderLoading,
    setInnerFolderLoading,
  ] = useState(false);

  const [
    innerFolderError,
    setInnerFolderError,
  ] = useState("");

  const [uploadLoading, setUploadLoading] =
    useState(false);

  const uploadInputRef =
    useRef<HTMLInputElement | null>(null);

  const [
    folderUploadLoading,
    setFolderUploadLoading,
  ] = useState(false);

  const [
    folderUploadProgress,
    setFolderUploadProgress,
  ] = useState({
    current: 0,
    total: 0,
  });

  const folderUploadInputRef =
    useRef<HTMLInputElement | null>(null);

  /*
   * Create main Syncthing folder
   */

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

  /*
   * Rename main Syncthing folder
   */

  const [renameTarget, setRenameTarget] =
    useState<SyncthingFolder | null>(null);

  const [renameLabel, setRenameLabel] =
    useState("");

  const [renameLoading, setRenameLoading] =
    useState(false);

  const [renameError, setRenameError] =
    useState("");

  /*
   * Remove main Syncthing folder
   */

  const [removeTarget, setRemoveTarget] =
    useState<SyncthingFolder | null>(null);

  const [removeLoading, setRemoveLoading] =
    useState(false);

  const [removeError, setRemoveError] =
    useState("");

  /*
   * Rename internal file or folder
   */

  const [
    entryRenameTarget,
    setEntryRenameTarget,
  ] = useState<BrowserEntry | null>(null);

  const [entryRenameName, setEntryRenameName] =
    useState("");

  const [
    entryRenameLoading,
    setEntryRenameLoading,
  ] = useState(false);

  const [
    entryRenameError,
    setEntryRenameError,
  ] = useState("");

  /*
   * Delete internal file or folder
   */

  const [
    entryDeleteTarget,
    setEntryDeleteTarget,
  ] = useState<BrowserEntry | null>(null);

  const [
    entryDeleteLoading,
    setEntryDeleteLoading,
  ] = useState(false);

  const [
    entryDeleteError,
    setEntryDeleteError,
  ] = useState("");

  async function loadData() {
    try {
      setLoading(true);
      setError("");

      const [statusResponse, foldersResponse] =
        await Promise.all([
          fetch(
            `${API_URL}/api/syncthing/status`,
          ),
          fetch(
            `${API_URL}/api/syncthing/folders`,
          ),
        ]);

      const statusData =
        await readResponseData(statusResponse);

      const foldersData =
        await readResponseData(foldersResponse);

      if (!statusResponse.ok) {
        throw new Error(
          getResponseMessage(
            statusData,
            "Could not load Syncthing status.",
          ),
        );
      }

      if (!foldersResponse.ok) {
        throw new Error(
          getResponseMessage(
            foldersData,
            "Could not load folders.",
          ),
        );
      }

      setStatus(
        statusData as unknown as SyncthingStatus,
      );

      setFolders(
        foldersData as unknown as SyncthingFolder[],
      );
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
      setActiveEntryMenuPath(null);
      setIsNewMenuOpen(false);
      setPreviewEntry(null);

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
          getResponseMessage(
            data,
            "Could not load the folder contents.",
          ),
        );
      }

      setBrowserData(
        data as unknown as BrowserResponse,
      );
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
    setIsNewMenuOpen(false);
    setActiveEntryMenuPath(null);
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
    void loadData();
  }, []);

  useEffect(() => {
    const input =
      folderUploadInputRef.current;

    if (input) {
      input.setAttribute(
        "webkitdirectory",
        "",
      );

      input.setAttribute(
        "directory",
        "",
      );
    }
  }, []);

  useEffect(() => {
    function closeMenus() {
      setActiveMenuId(null);
      setActiveEntryMenuPath(null);
      setIsNewMenuOpen(false);
    }

    window.addEventListener(
      "click",
      closeMenus,
    );

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
    function closeWithEscape(
      event: KeyboardEvent,
    ) {
      if (event.key !== "Escape") {
        return;
      }

      setPreviewEntry(null);
      setActiveMenuId(null);
      setActiveEntryMenuPath(null);
      setIsNewMenuOpen(false);
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

  /*
   * Create a main Syncthing folder
   */

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
          getResponseMessage(
            data,
            "The folder could not be created.",
          ),
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

  /*
   * Main Syncthing folder actions
   */

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
          getResponseMessage(
            data,
            "The folder action failed.",
          ),
        );
      }

      showSuccess(
        action === "open"
          ? `${folder.label} was opened.`
          : `Syncthing started scanning ${folder.label}.`,
      );
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
          getResponseMessage(
            data,
            "The folder state could not be changed.",
          ),
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
          getResponseMessage(
            data,
            "The folder could not be renamed.",
          ),
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
          getResponseMessage(
            data,
            "The folder could not be removed.",
          ),
        );
      }

      const removedLabel =
        removeTarget.label;

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

  /*
   * New button
   */

  function handleNewButton() {
    if (!selectedFolder) {
      openCreateDialog();

      return;
    }

    setIsNewMenuOpen(
      (current) => !current,
    );
  }

  /*
   * Create an internal folder
   */

  function openInnerFolderDialog() {
    setIsNewMenuOpen(false);
    setInnerFolderName("");
    setInnerFolderError("");
    setIsInnerFolderOpen(true);
  }

  function closeInnerFolderDialog() {
    if (innerFolderLoading) {
      return;
    }

    setIsInnerFolderOpen(false);
    setInnerFolderName("");
    setInnerFolderError("");
  }

  async function createInnerFolder(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (!selectedFolder) {
      return;
    }

    const cleanName =
      innerFolderName.trim();

    if (!cleanName) {
      setInnerFolderError(
        "Please enter a folder name.",
      );

      return;
    }

    try {
      setInnerFolderLoading(true);
      setInnerFolderError("");

      const response = await fetch(
        `${API_URL}/api/syncthing/folders/${encodeURIComponent(
          selectedFolder.id,
        )}/files/folders`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            parent_path:
              browserData?.current_path || "",
            name: cleanName,
          }),
        },
      );

      const data =
        await readResponseData(response);

      if (!response.ok) {
        throw new Error(
          getResponseMessage(
            data,
            "The folder could not be created.",
          ),
        );
      }

      setIsInnerFolderOpen(false);
      setInnerFolderName("");

      showSuccess(
        `${cleanName} was created successfully.`,
      );

      await loadBrowser(
        selectedFolder,
        browserData?.current_path || "",
      );
    } catch (requestError) {
      setInnerFolderError(
        requestError instanceof Error
          ? requestError.message
          : "The folder could not be created.",
      );
    } finally {
      setInnerFolderLoading(false);
    }
  }

  /*
   * Upload one file
   */

  async function uploadSelectedFile(
    file: File,
  ) {
    if (!selectedFolder) {
      return;
    }

    try {
      setUploadLoading(true);
      setIsNewMenuOpen(false);

      const formData = new FormData();

      formData.append(
        "path",
        browserData?.current_path || "",
      );

      formData.append(
        "overwrite",
        "false",
      );

      formData.append(
        "file",
        file,
      );

      const response = await fetch(
        `${API_URL}/api/syncthing/folders/${encodeURIComponent(
          selectedFolder.id,
        )}/files/upload`,
        {
          method: "POST",
          body: formData,
        },
      );

      const data =
        await readResponseData(response);

      if (!response.ok) {
        throw new Error(
          getResponseMessage(
            data,
            "The file could not be uploaded.",
          ),
        );
      }

      showSuccess(
        `${file.name} was uploaded successfully.`,
      );

      await loadBrowser(
        selectedFolder,
        browserData?.current_path || "",
      );
    } catch (requestError) {
      showError(
        requestError instanceof Error
          ? requestError.message
          : "The file could not be uploaded.",
      );
    } finally {
      setUploadLoading(false);

      if (uploadInputRef.current) {
        uploadInputRef.current.value = "";
      }
    }
  }

  /*
   * Upload a complete folder
   */

  async function uploadSelectedFolder(
    fileList: FileList,
  ) {
    if (
      !selectedFolder ||
      fileList.length === 0
    ) {
      return;
    }

    const files = Array.from(
      fileList,
    ) as DirectoryUploadFile[];

    const currentBrowserPath =
      browserData?.current_path || "";

    const uploadItems = files.map((file) => {
      const relativePath = (
        file.webkitRelativePath ||
        file.name
      )
        .replaceAll("\\", "/")
        .replace(/^\/+/, "");

      const pathParts = relativePath
        .split("/")
        .filter(Boolean);

      const fileName =
        pathParts.pop() || file.name;

      const relativeDirectory =
        pathParts.join("/");

      return {
        file,
        fileName,
        relativeDirectory,
      };
    });

    const requiredDirectories =
      new Set<string>();

    for (const item of uploadItems) {
      const directoryParts =
        item.relativeDirectory
          .split("/")
          .filter(Boolean);

      for (
        let index = 1;
        index <= directoryParts.length;
        index += 1
      ) {
        requiredDirectories.add(
          directoryParts
            .slice(0, index)
            .join("/"),
        );
      }
    }

    const orderedDirectories =
      Array.from(
        requiredDirectories,
      ).sort((first, second) => {
        return (
          first.split("/").length -
          second.split("/").length
        );
      });

    try {
      setFolderUploadLoading(true);
      setIsNewMenuOpen(false);

      setFolderUploadProgress({
        current: 0,
        total: files.length,
      });

      for (
        const relativeDirectory
        of orderedDirectories
      ) {
        const directoryParts =
          relativeDirectory.split("/");

        const directoryName =
          directoryParts.pop();

        if (!directoryName) {
          continue;
        }

        const relativeParent =
          directoryParts.join("/");

        const parentPath =
          joinBrowserPath(
            currentBrowserPath,
            relativeParent,
          );

        const response = await fetch(
          `${API_URL}/api/syncthing/folders/${encodeURIComponent(
            selectedFolder.id,
          )}/files/folders`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              parent_path: parentPath,
              name: directoryName,
            }),
          },
        );

        if (
          !response.ok &&
          response.status !== 409
        ) {
          const data =
            await readResponseData(response);

          throw new Error(
            getResponseMessage(
              data,
              `Could not create ${relativeDirectory}.`,
            ),
          );
        }
      }

      let uploadedCount = 0;
      const failedFiles: string[] = [];

      for (const item of uploadItems) {
        const destinationPath =
          joinBrowserPath(
            currentBrowserPath,
            item.relativeDirectory,
          );

        const formData = new FormData();

        formData.append(
          "path",
          destinationPath,
        );

        formData.append(
          "overwrite",
          "false",
        );

        formData.append(
          "file",
          item.file,
          item.fileName,
        );

        try {
          const response = await fetch(
            `${API_URL}/api/syncthing/folders/${encodeURIComponent(
              selectedFolder.id,
            )}/files/upload`,
            {
              method: "POST",
              body: formData,
            },
          );

          const data =
            await readResponseData(response);

          if (!response.ok) {
            throw new Error(
              getResponseMessage(
                data,
                "Upload failed.",
              ),
            );
          }

          uploadedCount += 1;
        } catch {
          failedFiles.push(
            item.relativeDirectory
              ? `${item.relativeDirectory}/${item.fileName}`
              : item.fileName,
          );
        }

        setFolderUploadProgress({
          current:
            uploadedCount +
            failedFiles.length,
          total: files.length,
        });
      }

      if (failedFiles.length > 0) {
        showError(
          `${uploadedCount} files uploaded. ` +
            `${failedFiles.length} files failed.`,
        );
      } else {
        showSuccess(
          `${uploadedCount} files uploaded successfully.`,
        );
      }

      await loadBrowser(
        selectedFolder,
        currentBrowserPath,
      );
    } catch (requestError) {
      showError(
        requestError instanceof Error
          ? requestError.message
          : "The folder could not be uploaded.",
      );
    } finally {
      setFolderUploadLoading(false);

      setFolderUploadProgress({
        current: 0,
        total: 0,
      });

      if (
        folderUploadInputRef.current
      ) {
        folderUploadInputRef.current.value =
          "";
      }
    }
  }

  /*
   * Rename an internal file or folder
   */

  function openEntryRenameDialog(
    entry: BrowserEntry,
  ) {
    setActiveEntryMenuPath(null);
    setPreviewEntry(null);
    setEntryRenameTarget(entry);
    setEntryRenameName(entry.name);
    setEntryRenameError("");
  }

  function closeEntryRenameDialog() {
    if (entryRenameLoading) {
      return;
    }

    setEntryRenameTarget(null);
    setEntryRenameName("");
    setEntryRenameError("");
  }

  async function renameBrowserEntry(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (
      !selectedFolder ||
      !entryRenameTarget
    ) {
      return;
    }

    const cleanName =
      entryRenameName.trim();

    if (!cleanName) {
      setEntryRenameError(
        "Please enter a new name.",
      );

      return;
    }

    try {
      setEntryRenameLoading(true);
      setEntryRenameError("");

      const response = await fetch(
        `${API_URL}/api/syncthing/folders/${encodeURIComponent(
          selectedFolder.id,
        )}/files/rename`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            path: entryRenameTarget.path,
            new_name: cleanName,
          }),
        },
      );

      const data =
        await readResponseData(response);

      if (!response.ok) {
        throw new Error(
          getResponseMessage(
            data,
            "The item could not be renamed.",
          ),
        );
      }

      const oldName =
        entryRenameTarget.name;

      setEntryRenameTarget(null);
      setEntryRenameName("");

      showSuccess(
        `${oldName} was renamed to ${cleanName}.`,
      );

      await loadBrowser(
        selectedFolder,
        browserData?.current_path || "",
      );
    } catch (requestError) {
      setEntryRenameError(
        requestError instanceof Error
          ? requestError.message
          : "The item could not be renamed.",
      );
    } finally {
      setEntryRenameLoading(false);
    }
  }

  /*
   * Permanently delete an internal file or folder
   */

  function openEntryDeleteDialog(
    entry: BrowserEntry,
  ) {
    setActiveEntryMenuPath(null);
    setPreviewEntry(null);
    setEntryDeleteTarget(entry);
    setEntryDeleteError("");
  }

  function closeEntryDeleteDialog() {
    if (entryDeleteLoading) {
      return;
    }

    setEntryDeleteTarget(null);
    setEntryDeleteError("");
  }

  async function deleteBrowserEntry() {
    if (
      !selectedFolder ||
      !entryDeleteTarget
    ) {
      return;
    }

    try {
      setEntryDeleteLoading(true);
      setEntryDeleteError("");

      const query = new URLSearchParams({
        path: entryDeleteTarget.path,
      });

      const response = await fetch(
        `${API_URL}/api/syncthing/folders/${encodeURIComponent(
          selectedFolder.id,
        )}/files?${query.toString()}`,
        {
          method: "DELETE",
        },
      );

      const data =
        await readResponseData(response);

      if (!response.ok) {
        throw new Error(
          getResponseMessage(
            data,
            "The item could not be deleted.",
          ),
        );
      }

      const deletedName =
        entryDeleteTarget.name;

      setEntryDeleteTarget(null);

      showSuccess(
        `${deletedName} was deleted permanently.`,
      );

      await loadBrowser(
        selectedFolder,
        browserData?.current_path || "",
      );
    } catch (requestError) {
      setEntryDeleteError(
        requestError instanceof Error
          ? requestError.message
          : "The item could not be deleted.",
      );
    } finally {
      setEntryDeleteLoading(false);
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

  const isAnyUploadRunning =
    uploadLoading ||
    folderUploadLoading;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            O
          </div>

          <div>
            <strong>OpenUI</strong>
            <span>Self-hosted cloud</span>
          </div>
        </div>

        <div
          className="new-menu-wrap"
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <button
            className="new-button"
            type="button"
            onClick={handleNewButton}
            disabled={isAnyUploadRunning}
          >
            <span>＋</span>

            {folderUploadLoading
              ? `Uploading ${folderUploadProgress.current}/${folderUploadProgress.total}`
              : uploadLoading
                ? "Uploading..."
                : "New"}
          </button>

          {selectedFolder &&
            isNewMenuOpen && (
              <div className="new-file-menu">
                <button
                  type="button"
                  onClick={
                    openInnerFolderDialog
                  }
                >
                  <span>▣</span>
                  New folder
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsNewMenuOpen(false);
                    uploadInputRef.current?.click();
                  }}
                >
                  <span>↑</span>
                  Upload file
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsNewMenuOpen(false);

                    folderUploadInputRef
                      .current
                      ?.click();
                  }}
                >
                  <span>⇧</span>
                  Upload folder
                </button>
              </div>
            )}

          <input
            ref={uploadInputRef}
            className="hidden-file-input"
            type="file"
            onChange={(event) => {
              const file =
                event.target.files?.[0];

              if (file) {
                void uploadSelectedFile(file);
              }
            }}
          />

          <input
            ref={folderUploadInputRef}
            className="hidden-file-input"
            type="file"
            multiple
            onChange={(event) => {
              const files =
                event.target.files;

              if (
                files &&
                files.length > 0
              ) {
                void uploadSelectedFolder(files);
              }
            }}
          />
        </div>

        <nav className="navigation">
          <button
            className="nav-item active"
            type="button"
            onClick={returnToMyFiles}
          >
            <span className="nav-icon">
              ▣
            </span>
            My Files
          </button>

          <button
            className="nav-item"
            type="button"
          >
            <span className="nav-icon">
              ⇄
            </span>
            Sync Folders
          </button>

          <button
            className="nav-item"
            type="button"
          >
            <span className="nav-icon">
              ◉
            </span>
            Devices
          </button>

          <button
            className="nav-item"
            type="button"
          >
            <span className="nav-icon">
              ◷
            </span>
            Activity
          </button>

          <button
            className="nav-item"
            type="button"
          >
            <span className="nav-icon">
              ⚙
            </span>
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
              {status?.syncthing_version ||
                ""}
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
                setSearch(
                  event.target.value,
                );
              }}
            />
          </label>

          <button
            className="refresh-button"
            type="button"
            onClick={() => {
              void refreshCurrentView();
            }}
            aria-label="Refresh"
            title="Refresh"
          >
            ↻
          </button>

          <div className="user-avatar">
            AM
          </div>
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
                    onClick={() => {
                      void loadData();
                    }}
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
                        {
                          filteredFolders.length
                        }{" "}
                        folder
                        {filteredFolders.length ===
                        1
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

                  {filteredFolders.length >
                  0 ? (
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
                              void loadBrowser(
                                folder,
                              );
                            }}
                          >
                            <div className="folder-card-top">
                              <div className="folder-icon">
                                <span />
                              </div>

                              <div
                                className="folder-menu-wrap"
                                onClick={(
                                  event,
                                ) => {
                                  event.stopPropagation();
                                }}
                              >
                                <button
                                  className="more-button"
                                  type="button"
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
                                        void runFolderAction(
                                          folder,
                                          "open",
                                        );
                                      }}
                                    >
                                      <span>
                                        ↗
                                      </span>
                                      Open folder
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => {
                                        void runFolderAction(
                                          folder,
                                          "scan",
                                        );
                                      }}
                                      disabled={
                                        folder.paused
                                      }
                                    >
                                      <span>
                                        ↻
                                      </span>
                                      Rescan
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => {
                                        void toggleFolderPaused(
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
                                      <span>
                                        ✎
                                      </span>
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
                                      <span>
                                        ×
                                      </span>
                                      Remove from
                                      Syncthing
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>

                            <h3>
                              {folder.label}
                            </h3>

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
                                {
                                  folder.device_count
                                }{" "}
                                device
                                {folder.device_count ===
                                1
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

                      <h2>
                        No folders found
                      </h2>

                      <p>
                        Try another search or
                        create a new sync
                        folder.
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
                      (
                        breadcrumb,
                        index,
                      ) => (
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

                              void loadBrowser(
                                selectedFolder,
                                breadcrumb.path,
                              );
                            }}
                          >
                            {
                              breadcrumb.label
                            }
                          </button>
                        </div>
                      ),
                    )}
                  </nav>
                )}
              </div>

              {browserLoading && (
                <div className="state-card">
                  Loading folder
                  contents...
                </div>
              )}

              {browserError && (
                <div className="state-card error-card">
                  <strong>
                    Could not open folder
                  </strong>

                  <p>{browserError}</p>

                  <button
                    type="button"
                    onClick={() => {
                      void loadBrowser(
                        selectedFolder,
                        browserData?.current_path ||
                          "",
                      );
                    }}
                  >
                    Try again
                  </button>
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
                          {
                            filteredEntries.length
                          }{" "}
                          item
                          {filteredEntries.length ===
                          1
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

                    {filteredEntries.length >
                    0 ? (
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

                                  void loadBrowser(
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
                              <div className="folder-card-top">
                                <div
                                  className={
                                    entry.is_folder
                                      ? "browser-entry-icon folder"
                                      : "browser-entry-icon file"
                                  }
                                >
                                  {entry.is_folder
                                    ? ""
                                    : getFileLabel(
                                        entry,
                                      )}
                                </div>

                                <div
                                  className="folder-menu-wrap"
                                  onClick={(
                                    event,
                                  ) => {
                                    event.stopPropagation();
                                  }}
                                >
                                  <button
                                    className="more-button"
                                    type="button"
                                    aria-label={`Options for ${entry.name}`}
                                    onClick={() => {
                                      setActiveEntryMenuPath(
                                        activeEntryMenuPath ===
                                          entry.path
                                          ? null
                                          : entry.path,
                                      );
                                    }}
                                  >
                                    •••
                                  </button>

                                  {activeEntryMenuPath ===
                                    entry.path && (
                                    <div className="folder-menu">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          openEntryRenameDialog(
                                            entry,
                                          );
                                        }}
                                      >
                                        <span>
                                          ✎
                                        </span>
                                        Rename
                                      </button>

                                      <button
                                        className="menu-danger"
                                        type="button"
                                        onClick={() => {
                                          openEntryDeleteDialog(
                                            entry,
                                          );
                                        }}
                                      >
                                        <span>
                                          ×
                                        </span>
                                        Delete permanently
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>

                              <h3>
                                {entry.name}
                              </h3>

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
                          Create a folder or
                          upload files using
                          the New button.
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

      {previewEntry &&
        selectedFolder && (
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
                    href={
                      previewDownloadUrl
                    }
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
                {previewType ===
                  "image" && (
                  <img
                    src={
                      previewContentUrl
                    }
                    alt={
                      previewEntry.name
                    }
                  />
                )}

                {previewType ===
                  "pdf" && (
                  <iframe
                    src={
                      previewContentUrl
                    }
                    title={
                      previewEntry.name
                    }
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
                      Preview is not
                      available
                    </h3>

                    <p>
                      Download the file
                      to open it with an
                      application on your
                      computer.
                    </p>

                    <a
                      className="preview-download-button large"
                      href={
                        previewDownloadUrl
                      }
                    >
                      Download file
                    </a>
                  </div>
                )}
              </div>

              <footer className="file-preview-footer">
                <span>Location</span>

                <strong>
                  {previewEntry.path}
                </strong>
              </footer>
            </section>
          </div>
        )}

      {entryRenameTarget && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              closeEntryRenameDialog();
            }
          }}
        >
          <section
            className="create-modal"
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-header">
              <div>
                <p>
                  RENAME{" "}
                  {entryRenameTarget.is_folder
                    ? "FOLDER"
                    : "FILE"}
                </p>

                <h2>
                  Change item name
                </h2>
              </div>

              <button
                className="modal-close"
                type="button"
                onClick={
                  closeEntryRenameDialog
                }
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <form
              className="create-form"
              onSubmit={
                renameBrowserEntry
              }
            >
              <label className="form-field">
                <span>New name</span>

                <input
                  type="text"
                  value={
                    entryRenameName
                  }
                  onChange={(event) => {
                    setEntryRenameName(
                      event.target.value,
                    );
                  }}
                  autoFocus
                />

                <small>
                  Current location:{" "}
                  {entryRenameTarget.path}
                </small>
              </label>

              {entryRenameError && (
                <div className="form-error">
                  {entryRenameError}
                </div>
              )}

              <div className="modal-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={
                    closeEntryRenameDialog
                  }
                  disabled={
                    entryRenameLoading
                  }
                >
                  Cancel
                </button>

                <button
                  className="primary-button"
                  type="submit"
                  disabled={
                    entryRenameLoading
                  }
                >
                  {entryRenameLoading
                    ? "Renaming..."
                    : "Save name"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {entryDeleteTarget && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              closeEntryDeleteDialog();
            }
          }}
        >
          <section
            className="create-modal"
            role="dialog"
            aria-modal="true"
          >
            <div className="modal-header">
              <div>
                <p>
                  DELETE{" "}
                  {entryDeleteTarget.is_folder
                    ? "FOLDER"
                    : "FILE"}
                </p>

                <h2>
                  Delete{" "}
                  {entryDeleteTarget.name}?
                </h2>
              </div>

              <button
                className="modal-close"
                type="button"
                onClick={
                  closeEntryDeleteDialog
                }
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="create-form">
              <div className="remove-warning">
                <strong>
                  This action is permanent.
                </strong>

                <p>
                  {entryDeleteTarget.is_folder
                    ? "The folder and everything inside it will be deleted from this computer and synchronized devices."
                    : "The file will be deleted from this computer and synchronized devices."}
                </p>
              </div>

              <div className="remove-path">
                <span>
                  Item location:
                </span>

                <strong>
                  {entryDeleteTarget.path}
                </strong>
              </div>

              {entryDeleteError && (
                <div className="form-error">
                  {entryDeleteError}
                </div>
              )}

              <div className="modal-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={
                    closeEntryDeleteDialog
                  }
                  disabled={
                    entryDeleteLoading
                  }
                >
                  Cancel
                </button>

                <button
                  className="danger-button"
                  type="button"
                  onClick={() => {
                    void deleteBrowserEntry();
                  }}
                  disabled={
                    entryDeleteLoading
                  }
                >
                  {entryDeleteLoading
                    ? "Deleting..."
                    : "Delete permanently"}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {isInnerFolderOpen &&
        selectedFolder && (
          <div
            className="modal-backdrop"
            onMouseDown={(event) => {
              if (
                event.target ===
                event.currentTarget
              ) {
                closeInnerFolderDialog();
              }
            }}
          >
            <section
              className="create-modal"
              role="dialog"
              aria-modal="true"
            >
              <div className="modal-header">
                <div>
                  <p>NEW FOLDER</p>
                  <h2>
                    Create a folder
                  </h2>
                </div>

                <button
                  className="modal-close"
                  type="button"
                  onClick={
                    closeInnerFolderDialog
                  }
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              <form
                className="create-form"
                onSubmit={
                  createInnerFolder
                }
              >
                <label className="form-field">
                  <span>
                    Folder name
                  </span>

                  <input
                    type="text"
                    placeholder="Example: Documents"
                    value={
                      innerFolderName
                    }
                    onChange={(event) => {
                      setInnerFolderName(
                        event.target.value,
                      );
                    }}
                    autoFocus
                  />

                  <small>
                    The folder will be
                    created inside{" "}
                    {browserData?.current_path ||
                      selectedFolder.label}
                    .
                  </small>
                </label>

                {innerFolderError && (
                  <div className="form-error">
                    {
                      innerFolderError
                    }
                  </div>
                )}

                <div className="modal-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={
                      closeInnerFolderDialog
                    }
                    disabled={
                      innerFolderLoading
                    }
                  >
                    Cancel
                  </button>

                  <button
                    className="primary-button"
                    type="submit"
                    disabled={
                      innerFolderLoading
                    }
                  >
                    {innerFolderLoading
                      ? "Creating..."
                      : "Create folder"}
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}

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
          >
            <div className="modal-header">
              <div>
                <p>
                  NEW SYNC FOLDER
                </p>

                <h2>
                  Create a sync folder
                </h2>
              </div>

              <button
                className="modal-close"
                type="button"
                onClick={
                  closeCreateDialog
                }
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
                  Location on this
                  computer
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
                    Keep files synchronized
                    everywhere
                  </option>

                  <option value="sendonly">
                    Send from this device
                    only
                  </option>

                  <option value="receiveonly">
                    Receive on this device
                    only
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
                  onClick={
                    closeCreateDialog
                  }
                  disabled={
                    createLoading
                  }
                >
                  Cancel
                </button>

                <button
                  className="primary-button"
                  type="submit"
                  disabled={
                    createLoading
                  }
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
          >
            <div className="modal-header">
              <div>
                <p>RENAME FOLDER</p>

                <h2>
                  Change folder name
                </h2>
              </div>

              <button
                className="modal-close"
                type="button"
                onClick={
                  closeRenameDialog
                }
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
                  onClick={
                    closeRenameDialog
                  }
                  disabled={
                    renameLoading
                  }
                >
                  Cancel
                </button>

                <button
                  className="primary-button"
                  type="submit"
                  disabled={
                    renameLoading
                  }
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
          >
            <div className="modal-header">
              <div>
                <p>
                  REMOVE SYNC FOLDER
                </p>

                <h2>
                  Remove{" "}
                  {removeTarget.label}?
                </h2>
              </div>

              <button
                className="modal-close"
                type="button"
                onClick={
                  closeRemoveDialog
                }
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="create-form">
              <div className="remove-warning">
                <strong>
                  Your files will not
                  be deleted.
                </strong>

                <p>
                  This only removes
                  the folder from
                  Syncthing and
                  OpenUI.
                </p>
              </div>

              <div className="remove-path">
                <span>
                  Files will remain at:
                </span>

                <strong>
                  {removeTarget.path}
                </strong>
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
                  onClick={
                    closeRemoveDialog
                  }
                  disabled={
                    removeLoading
                  }
                >
                  Cancel
                </button>

                <button
                  className="danger-button"
                  type="button"
                  onClick={() => {
                    void removeFolder();
                  }}
                  disabled={
                    removeLoading
                  }
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