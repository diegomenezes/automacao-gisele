import { google, drive_v3 } from "googleapis";
import { getGoogleAuth } from "../calendar";

let driveClient: drive_v3.Drive | null = null;

export function getDriveClient(): drive_v3.Drive {
  if (!driveClient) {
    const auth = getGoogleAuth();
    driveClient = google.drive({ version: "v3", auth });
  }
  return driveClient;
}

export async function findFolderByName(
  drive: drive_v3.Drive,
  parentId: string,
  name: string
): Promise<drive_v3.Schema$File | null> {
  const response = await drive.files.list({
    q: `'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id, name, webViewLink)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return response.data.files?.[0] ?? null;
}
