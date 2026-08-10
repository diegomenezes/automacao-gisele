import type { SpecialistConfig } from "../types";
import { listEnabledSpecialistConfigs, listSpecialistConfigs } from "../database/specialists";

function normalizeAlias(value: string): string {
  return value.trim().toLowerCase();
}

export function matchSpecialistFromTitle(
  title: string,
  configs: SpecialistConfig[]
): SpecialistConfig | null {
  const extracted = extractLabelFromCaptureTitle(title);
  if (!extracted) return null;

  const normalizedExtracted = normalizeAlias(extracted);

  for (const config of configs) {
    if (!config.enabled) continue;

    if (normalizeAlias(config.name) === normalizedExtracted) {
      return config;
    }

    for (const alias of config.calendar_aliases) {
      if (normalizeAlias(alias) === normalizedExtracted) {
        return config;
      }
    }
  }

  return null;
}

export function extractLabelFromCaptureTitle(title: string): string | null {
  const patterns = [
    /CAPTAÇÃO\s*[-–—]\s*(.+)/i,
    /\[CAPTACAO\]\s*[-–—]?\s*(.+)/i,
    /CAPTACAO\s*[-–—]\s*(.+)/i,
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
}

export async function resolveSpecialistForTitle(title: string): Promise<SpecialistConfig | null> {
  const configs = await listEnabledSpecialistConfigs();
  return matchSpecialistFromTitle(title, configs);
}

export async function getSpecialistConfigById(id: string): Promise<SpecialistConfig | null> {
  const { getSpecialistConfig } = await import("../database/specialists");
  return getSpecialistConfig(id);
}

export async function getSpecialistConfigByName(name: string): Promise<SpecialistConfig | null> {
  const configs = await listSpecialistConfigs();
  const normalized = normalizeAlias(name);
  return (
    configs.find(
      (c) =>
        normalizeAlias(c.name) === normalized ||
        c.calendar_aliases.some((a) => normalizeAlias(a) === normalized)
    ) ?? null
  );
}
