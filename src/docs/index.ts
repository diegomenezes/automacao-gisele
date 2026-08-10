import { google } from "googleapis";
import { getGoogleAuth } from "../calendar";

export async function exportGoogleDocAsText(documentId: string): Promise<string> {
  const auth = getGoogleAuth();
  const docs = google.docs({ version: "v1", auth });

  const response = await docs.documents.get({ documentId });
  const body = response.data.body;

  if (!body?.content) {
    return "";
  }

  const parts: string[] = [];

  for (const element of body.content) {
    if (element.paragraph?.elements) {
      for (const el of element.paragraph.elements) {
        if (el.textRun?.content) {
          parts.push(el.textRun.content);
        }
      }
    }
  }

  return parts.join("").trim();
}
