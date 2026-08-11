import { google, docs_v1 } from "googleapis";
import { getGoogleAuth } from "../calendar";

function extractParagraphText(paragraph: docs_v1.Schema$Paragraph): string {
  const parts: string[] = [];
  for (const el of paragraph.elements ?? []) {
    if (el.textRun?.content) {
      parts.push(el.textRun.content);
    }
  }
  return parts.join("");
}

function extractStructuralElements(
  elements: docs_v1.Schema$StructuralElement[] | undefined
): string {
  if (!elements?.length) return "";

  const parts: string[] = [];

  for (const element of elements) {
    if (element.paragraph) {
      parts.push(extractParagraphText(element.paragraph));
      continue;
    }

    if (element.table?.tableRows) {
      for (const row of element.table.tableRows) {
        const cells: string[] = [];
        for (const cell of row.tableCells ?? []) {
          const cellText = extractStructuralElements(cell.content).trim();
          if (cellText) cells.push(cellText);
        }
        if (cells.length) {
          parts.push(cells.join(" | ") + "\n");
        }
      }
      continue;
    }

    if (element.tableOfContents?.content) {
      parts.push(extractStructuralElements(element.tableOfContents.content));
    }
  }

  return parts.join("");
}

export async function exportGoogleDocAsText(documentId: string): Promise<string> {
  const auth = getGoogleAuth();
  const docs = google.docs({ version: "v1", auth });

  const response = await docs.documents.get({ documentId });
  const body = response.data.body;

  if (!body?.content) {
    return "";
  }

  return extractStructuralElements(body.content).trim();
}
