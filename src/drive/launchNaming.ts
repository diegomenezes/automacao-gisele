import type { SpecialistConfig, LaunchFolderPlan } from "../types";
import { listChildFolders, resolvePathFolder } from "./pathNavigator";

export function formatFolderNameFromTemplate(template: string, n: number): string {
  const nn = String(n).padStart(2, "0");
  return template.replace(/\{\{nn\}\}/g, nn).replace(/\{\{n\}\}/g, String(n));
}

export function parseFolderIncrement(
  folderName: string,
  regexPattern: string,
  incrementGroup: number
): number | null {
  try {
    const regex = new RegExp(regexPattern);
    const match = folderName.match(regex);
    if (!match || incrementGroup < 1 || incrementGroup >= match.length) {
      return null;
    }
    const value = parseInt(match[incrementGroup], 10);
    return Number.isNaN(value) ? null : value;
  } catch {
    return null;
  }
}

export interface ParsedLaunchFolder {
  id: string;
  name: string;
  increment: number;
}

export async function computeNextLaunchFolder(
  config: SpecialistConfig
): Promise<LaunchFolderPlan> {
  const { folder, resolvedPath } = await resolvePathFolder(
    config.drive_root_folder_id,
    config.path_segments
  );

  const copyParentFolderId = folder.id;
  const children = await listChildFolders(copyParentFolderId);

  const parsed: ParsedLaunchFolder[] = [];
  for (const child of children) {
    const increment = parseFolderIncrement(
      child.name,
      config.folder_parse_regex,
      config.increment_group
    );
    if (increment !== null) {
      parsed.push({ id: child.id, name: child.name, increment });
    }
  }

  const maxN =
    parsed.length > 0 ? Math.max(...parsed.map((p) => p.increment)) : config.initial_number - 1;
  const nextN = maxN + 1;
  const folderName = formatFolderNameFromTemplate(config.folder_name_template, nextN);

  const previous =
    parsed.length > 0
      ? parsed.sort((a, b) => b.increment - a.increment)[0]
      : null;

  return {
    folderName,
    nextNumber: nextN,
    previousFolderId: previous?.id ?? null,
    previousFolderName: previous?.name ?? null,
    copyParentFolderId,
    resolvedPath,
  };
}

export async function previewLaunchFolder(config: SpecialistConfig): Promise<{
  plan: LaunchFolderPlan;
  existingFolders: ParsedLaunchFolder[];
}> {
  const plan = await computeNextLaunchFolder(config);
  const children = await listChildFolders(plan.copyParentFolderId);
  const existingFolders: ParsedLaunchFolder[] = [];

  for (const child of children) {
    const increment = parseFolderIncrement(
      child.name,
      config.folder_parse_regex,
      config.increment_group
    );
    if (increment !== null) {
      existingFolders.push({ id: child.id, name: child.name, increment });
    }
  }

  existingFolders.sort((a, b) => b.increment - a.increment);

  return { plan, existingFolders };
}
