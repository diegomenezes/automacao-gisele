import { config } from "../config";
import { logger } from "../utils/logger";

export interface EvolutionGroup {
  id: string;
  name: string;
  subject?: string;
}

export interface EvolutionConnectionState {
  instance: string;
  state: string;
  connected: boolean;
}

function getBaseUrl(): string {
  const url = config.evolution.apiUrl?.trim();
  if (!url) {
    throw new Error("EVOLUTION_API_URL não configurada");
  }
  return url.replace(/\/$/, "");
}

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (config.evolution.apiKey) {
    headers.apikey = config.evolution.apiKey;
  }
  return headers;
}

export async function evolutionRequest<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const url = `${getBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;

  const response = await fetch(url, {
    method,
    headers: getHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let data: unknown = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const message =
      typeof data === "object" && data !== null && "response" in data
        ? JSON.stringify((data as { response: unknown }).response)
        : text || response.statusText;
    throw new Error(`Evolution API (${response.status}): ${message}`);
  }

  return data as T;
}

/**
 * Normaliza destino para Evolution API.
 * Grupos: 120363...@g.us
 * Contatos: 5511999999999
 */
export function normalizeWhatsAppDestination(raw: string): string {
  const value = raw.trim();
  if (!value) {
    throw new Error("Destino WhatsApp vazio");
  }

  if (value.includes("@")) {
    return value;
  }

  const digits = value.replace(/\D/g, "");
  if (!digits) {
    throw new Error(`Destino WhatsApp inválido: ${raw}`);
  }

  // IDs longos (>15 dígitos) são tipicamente group JID sem sufixo
  if (digits.length > 15) {
    return `${digits}@g.us`;
  }

  return digits;
}

export async function sendEvolutionText(number: string, text: string): Promise<void> {
  const instance = config.evolution.instance;
  const destination = normalizeWhatsAppDestination(number);

  await evolutionRequest("POST", `/message/sendText/${encodeURIComponent(instance)}`, {
    number: destination,
    text,
    linkPreview: false,
  });

  logger.info({ destination, instance }, "Evolution API message sent");
}

export async function getConnectionState(): Promise<EvolutionConnectionState> {
  const instance = config.evolution.instance;

  try {
    const data = await evolutionRequest<{ instance?: { state?: string }; state?: string }>(
      "GET",
      `/instance/connectionState/${encodeURIComponent(instance)}`
    );

    const state = data.instance?.state ?? data.state ?? "unknown";
    const connected = ["open", "connected"].includes(state.toLowerCase());

    return { instance, state, connected };
  } catch (error) {
    logger.warn({ error }, "Failed to fetch Evolution connection state");
    return { instance, state: "error", connected: false };
  }
}

export async function fetchEvolutionGroups(): Promise<EvolutionGroup[]> {
  const instance = config.evolution.instance;

  const data = await evolutionRequest<
    Array<{ id?: string; subject?: string; name?: string }> | { groups?: Array<{ id?: string; subject?: string }> }
  >("GET", `/group/fetchAllGroups/${encodeURIComponent(instance)}?getParticipants=false`);

  const groups = Array.isArray(data) ? data : data.groups ?? [];

  return groups
    .filter((g) => g.id)
    .map((g) => ({
      id: g.id!,
      name: g.subject ?? g.name ?? g.id!,
      subject: g.subject,
    }));
}

export function isEvolutionConfigured(): boolean {
  return Boolean(config.evolution.apiUrl && config.evolution.instance);
}
