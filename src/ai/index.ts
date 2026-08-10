import OpenAI from "openai";
import { config } from "../config";
import { BRIEFING_PROMPT } from "./prompt";
import { logger } from "../utils/logger";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    if (!config.openai.apiKey) {
      throw new Error("OPENAI_API_KEY is not configured");
    }
    client = new OpenAI({
      apiKey: config.openai.apiKey,
      baseURL: config.openai.baseUrl || undefined,
    });
  }
  return client;
}

export async function generateLaunchBriefing(copyContent: string): Promise<string> {
  const openai = getClient();

  const response = await openai.chat.completions.create({
    model: config.openai.model,
    messages: [
      {
        role: "user",
        content: BRIEFING_PROMPT + copyContent,
      },
    ],
    temperature: 0.3,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI returned empty response");
  }

  logger.info("Briefing generated successfully");
  return content;
}

export const NO_PREVIOUS_LAUNCH_MESSAGE = `# Resumo do Último Lançamento

Não foi encontrado lançamento anterior para este especialista.

Este é o primeiro lançamento automatizado ou não há pastas anteriores no Drive.
`;
