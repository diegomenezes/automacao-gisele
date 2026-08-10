import { drive_v3 } from "googleapis";
import { findFolderByName, getDriveClient } from "./client";

export interface FolderRef {
  id: string;
  name: string;
  webViewLink?: string | null;
}

export async function listChildFolders(parentId: string): Promise<FolderRef[]> {
  const drive = getDriveClient();
  const response = await drive.files.list({
    q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id, name, webViewLink)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  return (response.data.files ?? [])
    .filter((f) => f.id && f.name)
    .map((f) => ({
      id: f.id!,
      name: f.name!,
      webViewLink: f.webViewLink,
    }));
}

export async function resolvePathFolder(
  rootFolderId: string,
  segments: string[]
): Promise<{ folder: FolderRef; resolvedPath: string[] }> {
  const drive = getDriveClient();
  let currentId = rootFolderId;
  const resolvedPath: string[] = [];

  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed) continue;

    const folder = await findFolderByName(drive, currentId, trimmed);
    if (!folder?.id) {
      throw new Error(
        `Pasta não encontrada no caminho: "${trimmed}" (após: ${resolvedPath.join("/") || "raiz"})`
      );
    }

    currentId = folder.id;
    resolvedPath.push(trimmed);
  }

  const folder = await drive.files.get({
    fileId: currentId,
    fields: "id, name, webViewLink",
    supportsAllDrives: true,
  });

  if (!folder.data.id || !folder.data.name) {
    throw new Error("Falha ao resolver pasta final do caminho");
  }

  return {
    folder: {
      id: folder.data.id,
      name: folder.data.name,
      webViewLink: folder.data.webViewLink,
    },
    resolvedPath,
  };
}

export async function ensureFolderInParent(
  parentId: string,
  name: string
): Promise<FolderRef & { created: boolean }> {
  const drive = getDriveClient();
  const existing = await findFolderByName(drive, parentId, name);

  if (existing?.id) {
    return {
      id: existing.id,
      name: existing.name ?? name,
      webViewLink: existing.webViewLink,
      created: false,
    };
  }

  const response = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id, name, webViewLink",
    supportsAllDrives: true,
  });

  if (!response.data.id) {
    throw new Error(`Falha ao criar pasta: ${name}`);
  }

  return {
    id: response.data.id,
    name: response.data.name ?? name,
    webViewLink: response.data.webViewLink,
    created: true,
  };
}
