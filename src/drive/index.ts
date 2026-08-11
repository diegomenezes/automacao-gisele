import { Readable } from "stream";
import { config } from "../config";
import { logger } from "../utils/logger";
import { ensureFolderInParent } from "./pathNavigator";
import { getDriveClient } from "./client";
export { getDriveClient, findFolderByName } from "./client";

export interface LaunchFolderResult {
  launchFolderId: string;
  launchFolderUrl: string;
  launchFolderName: string;
  created: boolean;
}

export async function ensureLaunchFolder(
  copyParentFolderId: string,
  folderName: string
): Promise<LaunchFolderResult> {
  const folder = await ensureFolderInParent(copyParentFolderId, folderName);
  const launchFolderId = folder.id;

  logger.info({ folderName, created: folder.created }, "Launch folder ensured");

  return {
    launchFolderId,
    launchFolderUrl:
      folder.webViewLink ?? `https://drive.google.com/drive/folders/${launchFolderId}`,
    launchFolderName: folder.name,
    created: folder.created,
  };
}

export async function copyCopyTemplateToFolder(
  templateId: string,
  destinationFolderId: string
): Promise<string> {
  const drive = getDriveClient();

  const existing = await drive.files.list({
    q: `'${destinationFolderId}' in parents and trashed = false`,
    fields: "files(id, name)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  if (existing.data.files && existing.data.files.length > 0) {
    logger.info({ destinationFolderId }, "Launch folder already has files, skipping copy");
    return existing.data.files[0].id!;
  }

  const response = await drive.files.copy({
    fileId: templateId,
    requestBody: {
      parents: [destinationFolderId],
    },
    supportsAllDrives: true,
    fields: "id",
  });

  if (!response.data.id) {
    throw new Error(`Failed to copy copy template ${templateId}`);
  }

  return response.data.id;
}

export async function findFirstGoogleDocInFolder(folderId: string): Promise<string | null> {
  const drive = getDriveClient();
  const response = await drive.files.list({
    q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.document' and trashed = false`,
    fields: "files(id, name)",
    orderBy: "createdTime",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const files = response.data.files ?? [];
  if (!files.length) return null;

  // Prefer the launch copy doc when multiple Google Docs exist in the folder.
  const preferred =
    files.find((f) => /copy/i.test(f.name ?? "") && /lan[cç]amento/i.test(f.name ?? "")) ??
    files.find((f) => /copy/i.test(f.name ?? "")) ??
    files[0];

  return preferred.id ?? null;
}

export async function uploadTextFile(
  parentFolderId: string,
  fileName: string,
  content: string
): Promise<string> {
  const drive = getDriveClient();

  const existing = await drive.files.list({
    q: `'${parentFolderId}' in parents and name = '${fileName.replace(/'/g, "\\'")}' and trashed = false`,
    fields: "files(id)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  if (existing.data.files?.[0]?.id) {
    const fileId = existing.data.files[0].id!;
    await drive.files.update({
      fileId,
      media: {
        mimeType: "text/markdown",
        body: Readable.from([content]),
      },
      supportsAllDrives: true,
    });
    return fileId;
  }

  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [parentFolderId],
      mimeType: "text/markdown",
    },
    media: {
      mimeType: "text/markdown",
      body: Readable.from([content]),
    },
    fields: "id",
    supportsAllDrives: true,
  });

  if (!response.data.id) {
    throw new Error(`Failed to upload file: ${fileName}`);
  }
  return response.data.id;
}

export function resolveCopyTemplateId(specialistTemplateId: string | null): string {
  const templateId = specialistTemplateId || config.templates.copy;
  if (!templateId) {
    throw new Error("Template Copy não configurado (especialista ou TEMPLATE_COPY_ID no .env)");
  }
  return templateId;
}
