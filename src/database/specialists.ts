import { v4 as uuidv4 } from "uuid";
import { getDb } from "./index";
import type { LaunchAssetsConfig, SpecialistConfig } from "../types";

function parseLaunchAssets(raw: unknown): LaunchAssetsConfig | null {
  if (!raw) return null;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    if (
      typeof obj.links_file_template !== "string" ||
      typeof obj.static_captacao_template !== "string" ||
      typeof obj.static_lembrete_template !== "string" ||
      typeof obj.static_carrinho_template !== "string" ||
      typeof obj.video_captacao_template !== "string"
    ) {
      return null;
    }
    return {
      links_file_template: obj.links_file_template,
      static_captacao_template: obj.static_captacao_template,
      static_lembrete_template: obj.static_lembrete_template,
      static_carrinho_template: obj.static_carrinho_template,
      video_captacao_template: obj.video_captacao_template,
    };
  } catch {
    return null;
  }
}

function rowToConfig(row: Record<string, unknown>): SpecialistConfig {
  return {
    id: row.id as string,
    name: row.name as string,
    calendar_aliases: JSON.parse(row.calendar_aliases as string) as string[],
    drive_root_folder_id: row.drive_root_folder_id as string,
    path_segments: JSON.parse(row.path_segments as string) as string[],
    folder_name_template: row.folder_name_template as string,
    folder_parse_regex: row.folder_parse_regex as string,
    increment_group: row.increment_group as number,
    initial_number: row.initial_number as number,
    template_copy_id: (row.template_copy_id as string) || null,
    launch_assets: parseLaunchAssets(row.launch_assets),
    enabled: Boolean(row.enabled),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export function listSpecialistConfigs(): SpecialistConfig[] {
  const rows = getDb()
    .prepare(`SELECT * FROM specialist_configs ORDER BY name`)
    .all() as Record<string, unknown>[];
  return rows.map(rowToConfig);
}

export function listEnabledSpecialistConfigs(): SpecialistConfig[] {
  const rows = getDb()
    .prepare(`SELECT * FROM specialist_configs WHERE enabled = 1 ORDER BY name`)
    .all() as Record<string, unknown>[];
  return rows.map(rowToConfig);
}

export function getSpecialistConfig(id: string): SpecialistConfig | null {
  const row = getDb()
    .prepare(`SELECT * FROM specialist_configs WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToConfig(row) : null;
}

export function createSpecialistConfig(
  data: Omit<SpecialistConfig, "id" | "created_at" | "updated_at">
): SpecialistConfig {
  const id = uuidv4();
  const now = new Date().toISOString();

  getDb()
    .prepare(
      `INSERT INTO specialist_configs (
        id, name, calendar_aliases, drive_root_folder_id, path_segments,
        folder_name_template, folder_parse_regex, increment_group, initial_number,
        template_copy_id, launch_assets, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      data.name,
      JSON.stringify(data.calendar_aliases),
      data.drive_root_folder_id,
      JSON.stringify(data.path_segments),
      data.folder_name_template,
      data.folder_parse_regex,
      data.increment_group,
      data.initial_number,
      data.template_copy_id,
      data.launch_assets ? JSON.stringify(data.launch_assets) : null,
      data.enabled ? 1 : 0,
      now,
      now
    );

  return getSpecialistConfig(id)!;
}

export function updateSpecialistConfig(
  id: string,
  data: Partial<Omit<SpecialistConfig, "id" | "created_at" | "updated_at">>
): SpecialistConfig | null {
  const existing = getSpecialistConfig(id);
  if (!existing) return null;

  const updated: SpecialistConfig = {
    ...existing,
    ...data,
    calendar_aliases: data.calendar_aliases ?? existing.calendar_aliases,
    path_segments: data.path_segments ?? existing.path_segments,
    launch_assets:
      data.launch_assets !== undefined ? data.launch_assets : existing.launch_assets,
    updated_at: new Date().toISOString(),
  };

  getDb()
    .prepare(
      `UPDATE specialist_configs SET
        name = ?, calendar_aliases = ?, drive_root_folder_id = ?, path_segments = ?,
        folder_name_template = ?, folder_parse_regex = ?, increment_group = ?,
        initial_number = ?, template_copy_id = ?, launch_assets = ?, enabled = ?, updated_at = ?
      WHERE id = ?`
    )
    .run(
      updated.name,
      JSON.stringify(updated.calendar_aliases),
      updated.drive_root_folder_id,
      JSON.stringify(updated.path_segments),
      updated.folder_name_template,
      updated.folder_parse_regex,
      updated.increment_group,
      updated.initial_number,
      updated.template_copy_id,
      updated.launch_assets ? JSON.stringify(updated.launch_assets) : null,
      updated.enabled ? 1 : 0,
      updated.updated_at,
      id
    );

  return getSpecialistConfig(id);
}

export function deleteSpecialistConfig(id: string): boolean {
  const result = getDb().prepare(`DELETE FROM specialist_configs WHERE id = ?`).run(id);
  return result.changes > 0;
}
