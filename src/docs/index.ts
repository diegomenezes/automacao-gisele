import { google, docs_v1 } from "googleapis";
import { getGoogleAuth } from "../calendar";
import { logger } from "../utils/logger";

type DocsTab = {
  tabProperties?: { title?: string; tabId?: string };
  documentTab?: { body?: { content?: docs_v1.Schema$StructuralElement[] } };
  childTabs?: DocsTab[];
};

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

function flattenTabs(tabs: DocsTab[] | undefined): Array<{ title: string; text: string }> {
  const result: Array<{ title: string; text: string }> = [];

  for (const tab of tabs ?? []) {
    const title = tab.tabProperties?.title?.trim() || "Sem título";
    const text = extractStructuralElements(tab.documentTab?.body?.content).trim();
    if (text) {
      result.push({ title, text });
    }
    if (tab.childTabs?.length) {
      result.push(...flattenTabs(tab.childTabs));
    }
  }

  return result;
}

/** Tabs that usually carry price, offer, upsell and downsell. */
const PRIORITY_TAB_PATTERNS = [
  /^p[aá]ginas$/i,
  /^downsell$/i,
  /super interessados/i,
  /^reabertura$/i,
  /descri[cç][aã]o dos grupos/i,
  /^boas vindas$/i,
  /aviso b[oô]nus/i,
  /^email$/i,
  /grupos normais/i,
  /legenda/i,
];

function tabPriority(title: string): number {
  const idx = PRIORITY_TAB_PATTERNS.findIndex((p) => p.test(title));
  return idx === -1 ? PRIORITY_TAB_PATTERNS.length + 1 : idx;
}

/**
 * Builds a briefing-oriented excerpt: commercial tabs first, size-capped.
 */
export function buildBriefingSourceFromTabs(
  tabs: Array<{ title: string; text: string }>,
  maxChars = 100_000
): string {
  const sorted = [...tabs].sort((a, b) => tabPriority(a.title) - tabPriority(b.title));
  const parts: string[] = [];
  let used = 0;

  for (const tab of sorted) {
    const header = `\n\n===== ABA: ${tab.title} =====\n\n`;
    const remaining = maxChars - used - header.length;
    if (remaining <= 500) break;

    const body =
      tab.text.length > remaining
        ? `${tab.text.slice(0, remaining)}\n\n[... aba truncada ...]`
        : tab.text;

    parts.push(header + body);
    used += header.length + body.length;
  }

  return parts.join("").trim();
}

export async function exportGoogleDocAsText(documentId: string): Promise<string> {
  const auth = getGoogleAuth();
  const docs = google.docs({ version: "v1", auth });

  const response = await docs.documents.get({
    documentId,
    includeTabsContent: true,
  });

  const tabs = flattenTabs((response.data as { tabs?: DocsTab[] }).tabs);

  if (tabs.length > 0) {
    logger.info(
      { documentId, tabs: tabs.map((t) => t.title), totalChars: tabs.reduce((n, t) => n + t.text.length, 0) },
      "Exported Google Doc tabs"
    );
    return buildBriefingSourceFromTabs(tabs);
  }

  // Fallback for docs without tabs API payload.
  const body = response.data.body;
  if (!body?.content) {
    return "";
  }
  return extractStructuralElements(body.content).trim();
}
