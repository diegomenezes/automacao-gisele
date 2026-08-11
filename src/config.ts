import dotenv from "dotenv";

dotenv.config();

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

function optionalInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) return defaultValue;
  return parsed;
}

export const config = {
  google: {
    credentialsPath: optional("GOOGLE_APPLICATION_CREDENTIALS", "./credentials.json"),
    calendarId: optional("GOOGLE_CALENDAR_ID", "primary"),
    /** Workspace user to impersonate via domain-wide delegation */
    impersonateUser: process.env.GOOGLE_IMPERSONATE_USER ?? "",
    driveRootFolderId: process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID ?? "",
  },
  templates: {
    copy: process.env.TEMPLATE_COPY_ID ?? "",
    api: process.env.TEMPLATE_API_ID ?? "",
    page: process.env.TEMPLATE_PAGE_ID ?? "",
    emails: process.env.TEMPLATE_EMAILS_ID ?? "",
    creatives: process.env.TEMPLATE_CREATIVES_ID ?? "",
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? "",
    baseUrl: process.env.OPENAI_BASE_URL,
    model: optional("OPENAI_MODEL", "gpt-4o-mini"),
  },
  evolution: {
    apiUrl: process.env.EVOLUTION_API_URL ?? "",
    apiKey: process.env.EVOLUTION_API_KEY ?? "",
    instance: optional("EVOLUTION_INSTANCE", "default"),
    groupId: process.env.WHATSAPP_GROUP_ID ?? "",
  },
  database: {
    url: optional("DATABASE_URL", "./data/agent.db"),
  },
  scheduler: {
    cronSchedule: optional("CRON_SCHEDULE", "0 8 * * *"),
    captureWindowDays: optionalInt("CAPTURE_WINDOW_DAYS", 15),
    launchOffsetDays: optionalInt("LAUNCH_OFFSET_DAYS", 30),
    timezone: optional("TIMEZONE", "America/Sao_Paulo"),
  },
  admin: {
    user: optional("ADMIN_USER", "admin"),
    password: optional("ADMIN_PASSWORD", "change-me"),
    sessionSecret: optional("ADMIN_SESSION_SECRET", "change-me-session-secret"),
    port: optionalInt("ADMIN_PORT", 3000),
  },
  server: {
    port: optionalInt("PORT", 3000),
    nodeEnv: optional("NODE_ENV", "development"),
  },
};

export const LAUNCH_SUBFOLDERS = [
  "01 - Briefing",
  "02 - Copy",
  "03 - Criativos",
  "04 - Página",
  "05 - API",
  "06 - Emails",
  "07 - Videos",
  "08 - Grupo",
  "09 - Checkout",
  "10 - Relatórios",
] as const;

export const TEMPLATE_FOLDER_MAP: Record<string, string> = {
  copy: "02 - Copy",
  api: "05 - API",
  page: "04 - Página",
  emails: "06 - Emails",
  creatives: "03 - Criativos",
};

export function validateConfigForRun(): string[] {
  const missing: string[] = [];
  if (!config.google.calendarId) missing.push("GOOGLE_CALENDAR_ID");
  if (!config.openai.apiKey) missing.push("OPENAI_API_KEY");
  if (!config.evolution.apiUrl) missing.push("EVOLUTION_API_URL");
  if (!config.evolution.groupId) missing.push("WHATSAPP_GROUP_ID");
  return missing;
}
