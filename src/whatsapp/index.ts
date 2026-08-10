import { config } from "../config";
import { formatDateBR } from "../utils/date";
import { logger } from "../utils/logger";
import { isEvolutionConfigured, sendEvolutionText } from "./evolutionClient";

export interface WhatsAppNotificationData {
  captureDate: Date;
  specialistName?: string;
  launchFolderName?: string;
  checklist: {
    drive: boolean;
    templates: boolean;
    briefing: boolean;
  };
}

export function buildPreLaunchMessage(data: WhatsAppNotificationData): string {
  const dateStr = formatDateBR(data.captureDate);
  const lines = [
    "🚀 Pré-lançamento iniciado automaticamente.",
    "",
  ];

  if (data.specialistName) {
    lines.push(`Especialista: ${data.specialistName}`, "");
  }

  lines.push("Captação prevista:", dateStr, "");

  if (data.launchFolderName) {
    lines.push(`Pasta criada: ${data.launchFolderName}`, "");
  }

  lines.push(
    "Já foram preparados:",
    "",
    data.checklist.drive ? "✅ Estrutura do Drive" : "⏳ Estrutura do Drive",
    data.checklist.templates ? "✅ Modelo Copy" : "⏳ Modelo Copy",
    data.checklist.briefing ? "✅ Resumo do último lançamento" : "⏳ Resumo do último lançamento",
    "",
    "Agora falta apenas a reunião de definição da oferta."
  );

  return lines.join("\n");
}

export async function sendPreLaunchNotification(data: WhatsAppNotificationData): Promise<void> {
  const groupId = config.evolution.groupId;

  if (!isEvolutionConfigured()) {
    throw new Error("Evolution API não configurada (EVOLUTION_API_URL / EVOLUTION_INSTANCE)");
  }

  if (!groupId) {
    throw new Error("WHATSAPP_GROUP_ID não configurado");
  }

  const message = buildPreLaunchMessage(data);
  await sendEvolutionText(groupId, message);
  logger.info({ groupId }, "WhatsApp pré-lançamento enviado via Evolution API");
}

export async function sendTestMessage(text?: string): Promise<void> {
  const groupId = config.evolution.groupId;
  if (!groupId) {
    throw new Error("WHATSAPP_GROUP_ID não configurado");
  }

  const message =
    text ??
    "✅ Teste Evolution API — Agente de Pré-Lançamento conectado com sucesso.";

  await sendEvolutionText(groupId, message);
}
