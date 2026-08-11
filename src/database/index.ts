import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import { config } from "../config";
import type {
  JobLog,
  JobRun,
  JobTrigger,
  LaunchRun,
  PreparedLaunch,
  StepName,
  StepStatus,
} from "../types";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS job_runs (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  events_found INTEGER NOT NULL DEFAULT 0,
  events_processed INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS launch_runs (
  id TEXT PRIMARY KEY,
  job_run_id TEXT NOT NULL REFERENCES job_runs(id),
  specialist TEXT NOT NULL,
  specialist_config_id TEXT,
  launch_folder_name TEXT NOT NULL,
  capture_date TEXT NOT NULL,
  calendar_event_id TEXT,
  calendar_event_title TEXT,
  drive_folder_id TEXT,
  drive_folder_url TEXT,
  briefing_file_id TEXT,
  step_drive TEXT NOT NULL DEFAULT 'pending',
  step_templates TEXT NOT NULL DEFAULT 'pending',
  step_briefing TEXT NOT NULL DEFAULT 'pending',
  step_whatsapp TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  error_stack TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prepared_launches (
  id TEXT PRIMARY KEY,
  specialist TEXT NOT NULL,
  specialist_config_id TEXT,
  launch_folder_name TEXT NOT NULL,
  capture_date TEXT NOT NULL,
  calendar_event_id TEXT,
  prepared_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_logs (
  id TEXT PRIMARY KEY,
  job_run_id TEXT,
  launch_run_id TEXT,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS specialist_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  calendar_aliases TEXT NOT NULL,
  drive_root_folder_id TEXT NOT NULL,
  path_segments TEXT NOT NULL,
  folder_name_template TEXT NOT NULL,
  folder_parse_regex TEXT NOT NULL,
  increment_group INTEGER NOT NULL DEFAULT 1,
  initial_number INTEGER NOT NULL DEFAULT 1,
  template_copy_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_launch_runs_job_run ON launch_runs(job_run_id);
CREATE INDEX IF NOT EXISTS idx_job_logs_job_run ON job_logs(job_run_id);
CREATE INDEX IF NOT EXISTS idx_job_logs_launch_run ON job_logs(launch_run_id);
CREATE INDEX IF NOT EXISTS idx_prepared_launches_event ON prepared_launches(calendar_event_id);
CREATE INDEX IF NOT EXISTS idx_prepared_launches_capture ON prepared_launches(specialist_config_id, capture_date);
`;

function runMigrations(database: Database.Database): void {
  const launchRunsInfo = database.prepare(`PRAGMA table_info(launch_runs)`).all() as Array<{
    name: string;
  }>;
  const launchRunColumns = new Set(launchRunsInfo.map((c) => c.name));

  if (launchRunColumns.has("launch_month") && !launchRunColumns.has("launch_folder_name")) {
    database.exec(`ALTER TABLE launch_runs ADD COLUMN launch_folder_name TEXT`);
    database.exec(`UPDATE launch_runs SET launch_folder_name = launch_month WHERE launch_folder_name IS NULL`);
  }

  if (!launchRunColumns.has("specialist_config_id")) {
    database.exec(`ALTER TABLE launch_runs ADD COLUMN specialist_config_id TEXT`);
  }

  const preparedInfo = database.prepare(`PRAGMA table_info(prepared_launches)`).all() as Array<{
    name: string;
  }>;
  const preparedColumns = new Set(preparedInfo.map((c) => c.name));

  if (preparedColumns.has("launch_month") && !preparedColumns.has("launch_folder_name")) {
    database.exec(`ALTER TABLE prepared_launches ADD COLUMN launch_folder_name TEXT`);
    database.exec(
      `UPDATE prepared_launches SET launch_folder_name = launch_month WHERE launch_folder_name IS NULL`
    );
  }

  if (!preparedColumns.has("specialist_config_id")) {
    database.exec(`ALTER TABLE prepared_launches ADD COLUMN specialist_config_id TEXT`);
  }

  const specialistInfo = database.prepare(`PRAGMA table_info(specialist_configs)`).all() as Array<{
    name: string;
  }>;
  const specialistColumns = new Set(specialistInfo.map((c) => c.name));
  if (!specialistColumns.has("launch_assets")) {
    database.exec(`ALTER TABLE specialist_configs ADD COLUMN launch_assets TEXT`);
  }
}

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = config.database.url;
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.exec(SCHEMA);
    runMigrations(db);
  }
  return db;
}

export function createJobRun(trigger: JobTrigger): JobRun {
  const id = uuidv4();
  const started_at = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO job_runs (id, trigger, started_at, status) VALUES (?, ?, ?, 'running')`
    )
    .run(id, trigger, started_at);
  return {
    id,
    trigger,
    started_at,
    finished_at: null,
    status: "running",
    events_found: 0,
    events_processed: 0,
    error_message: null,
  };
}

export function updateJobRun(
  id: string,
  updates: Partial<
    Pick<JobRun, "status" | "finished_at" | "events_found" | "events_processed" | "error_message">
  >
): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) {
    fields.push("status = ?");
    values.push(updates.status);
  }
  if (updates.finished_at !== undefined) {
    fields.push("finished_at = ?");
    values.push(updates.finished_at);
  }
  if (updates.events_found !== undefined) {
    fields.push("events_found = ?");
    values.push(updates.events_found);
  }
  if (updates.events_processed !== undefined) {
    fields.push("events_processed = ?");
    values.push(updates.events_processed);
  }
  if (updates.error_message !== undefined) {
    fields.push("error_message = ?");
    values.push(updates.error_message);
  }

  if (fields.length === 0) return;
  values.push(id);
  getDb().prepare(`UPDATE job_runs SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}

export function createLaunchRun(
  jobRunId: string,
  data: {
    specialist: string;
    specialistConfigId?: string;
    launchFolderName: string;
    captureDate: string;
    calendarEventId?: string;
    calendarEventTitle?: string;
  }
): LaunchRun {
  const id = uuidv4();
  const created_at = new Date().toISOString();
  const db = getDb();

  const columns = (db.prepare(`PRAGMA table_info(launch_runs)`).all() as Array<{ name: string }>).map(
    (c) => c.name
  );
  const hasLegacyMonth = columns.includes("launch_month");

  if (hasLegacyMonth) {
    db.prepare(
      `INSERT INTO launch_runs (
        id, job_run_id, specialist, specialist_config_id, launch_folder_name, launch_month, capture_date,
        calendar_event_id, calendar_event_title, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      jobRunId,
      data.specialist,
      data.specialistConfigId ?? null,
      data.launchFolderName,
      data.launchFolderName,
      data.captureDate,
      data.calendarEventId ?? null,
      data.calendarEventTitle ?? null,
      created_at
    );
  } else {
    db.prepare(
      `INSERT INTO launch_runs (
        id, job_run_id, specialist, specialist_config_id, launch_folder_name, capture_date,
        calendar_event_id, calendar_event_title, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      jobRunId,
      data.specialist,
      data.specialistConfigId ?? null,
      data.launchFolderName,
      data.captureDate,
      data.calendarEventId ?? null,
      data.calendarEventTitle ?? null,
      created_at
    );
  }

  return getLaunchRun(id)!;
}

export function updateLaunchRun(
  id: string,
  updates: Partial<
    Pick<
      LaunchRun,
      | "drive_folder_id"
      | "drive_folder_url"
      | "briefing_file_id"
      | "step_drive"
      | "step_templates"
      | "step_briefing"
      | "step_whatsapp"
      | "error_message"
      | "error_stack"
      | "launch_folder_name"
    >
  >
): void {
  const map: Record<string, unknown> = {
    drive_folder_id: updates.drive_folder_id,
    drive_folder_url: updates.drive_folder_url,
    briefing_file_id: updates.briefing_file_id,
    step_drive: updates.step_drive,
    step_templates: updates.step_templates,
    step_briefing: updates.step_briefing,
    step_whatsapp: updates.step_whatsapp,
    error_message: updates.error_message,
    error_stack: updates.error_stack,
    launch_folder_name: updates.launch_folder_name,
  };

  const fields: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(map)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (fields.length === 0) return;
  values.push(id);
  getDb().prepare(`UPDATE launch_runs SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}

export function updateLaunchStep(id: string, step: StepName, status: StepStatus): void {
  const column = `step_${step}` as "step_drive" | "step_templates" | "step_briefing" | "step_whatsapp";
  updateLaunchRun(id, { [column]: status });
}

export function isCapturePrepared(data: {
  calendarEventId?: string;
  specialistConfigId: string;
  captureDate: string;
}): boolean {
  if (data.calendarEventId && !data.calendarEventId.startsWith("manual-")) {
    const byEvent = getDb()
      .prepare(`SELECT id FROM prepared_launches WHERE calendar_event_id = ?`)
      .get(data.calendarEventId);
    if (byEvent) return true;
  }

  const byDate = getDb()
    .prepare(
      `SELECT id FROM prepared_launches WHERE specialist_config_id = ? AND capture_date = ?`
    )
    .get(data.specialistConfigId, data.captureDate);
  return !!byDate;
}

export function markLaunchPrepared(data: {
  specialist: string;
  specialistConfigId: string;
  launchFolderName: string;
  captureDate: string;
  calendarEventId?: string;
}): PreparedLaunch {
  const id = uuidv4();
  const prepared_at = new Date().toISOString();

  const db = getDb();
  const preparedColumns = (db.prepare(`PRAGMA table_info(prepared_launches)`).all() as Array<{ name: string }>).map(
    (c) => c.name
  );
  const hasLegacyMonth = preparedColumns.includes("launch_month");

  if (data.calendarEventId && !data.calendarEventId.startsWith("manual-")) {
    db.prepare(`DELETE FROM prepared_launches WHERE calendar_event_id = ?`).run(data.calendarEventId);
  }

  if (hasLegacyMonth) {
    db.prepare(
      `INSERT INTO prepared_launches (
        id, specialist, specialist_config_id, launch_folder_name, launch_month, capture_date,
        calendar_event_id, prepared_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      data.specialist,
      data.specialistConfigId,
      data.launchFolderName,
      data.launchFolderName,
      data.captureDate,
      data.calendarEventId ?? null,
      prepared_at
    );
  } else {
    db.prepare(
      `INSERT INTO prepared_launches (
        id, specialist, specialist_config_id, launch_folder_name, capture_date,
        calendar_event_id, prepared_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      data.specialist,
      data.specialistConfigId,
      data.launchFolderName,
      data.captureDate,
      data.calendarEventId ?? null,
      prepared_at
    );
  }

  return {
    id,
    specialist: data.specialist,
    specialist_config_id: data.specialistConfigId,
    launch_folder_name: data.launchFolderName,
    capture_date: data.captureDate,
    calendar_event_id: data.calendarEventId ?? null,
    prepared_at,
  };
}

export function isLaunchFolderPrepared(
  specialistConfigId: string,
  launchFolderName: string
): boolean {
  const row = getDb()
    .prepare(
      `SELECT id FROM prepared_launches WHERE specialist_config_id = ? AND launch_folder_name = ?`
    )
    .get(specialistConfigId, launchFolderName);
  return !!row;
}

export function addJobLog(
  level: JobLog["level"],
  message: string,
  options?: { jobRunId?: string; launchRunId?: string; metadata?: Record<string, unknown> }
): JobLog {
  const id = uuidv4();
  const created_at = new Date().toISOString();
  const metadata = options?.metadata ? JSON.stringify(options.metadata) : null;
  getDb()
    .prepare(
      `INSERT INTO job_logs (id, job_run_id, launch_run_id, level, message, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      options?.jobRunId ?? null,
      options?.launchRunId ?? null,
      level,
      message,
      metadata,
      created_at
    );
  return {
    id,
    job_run_id: options?.jobRunId ?? null,
    launch_run_id: options?.launchRunId ?? null,
    level,
    message,
    metadata,
    created_at,
  };
}

export function getJobRun(id: string): JobRun | null {
  return getDb().prepare(`SELECT * FROM job_runs WHERE id = ?`).get(id) as JobRun | null;
}

export function getLaunchRun(id: string): LaunchRun | null {
  return getDb().prepare(`SELECT * FROM launch_runs WHERE id = ?`).get(id) as LaunchRun | null;
}

export function listJobRuns(limit = 50): JobRun[] {
  return getDb()
    .prepare(`SELECT * FROM job_runs ORDER BY started_at DESC LIMIT ?`)
    .all(limit) as JobRun[];
}

export function listLaunchRunsByJob(jobRunId: string): LaunchRun[] {
  return getDb()
    .prepare(`SELECT * FROM launch_runs WHERE job_run_id = ? ORDER BY created_at`)
    .all(jobRunId) as LaunchRun[];
}

export function listJobLogs(options?: {
  jobRunId?: string;
  launchRunId?: string;
  limit?: number;
}): JobLog[] {
  const limit = options?.limit ?? 200;
  if (options?.launchRunId) {
    return getDb()
      .prepare(
        `SELECT * FROM job_logs WHERE launch_run_id = ? ORDER BY created_at DESC LIMIT ?`
      )
      .all(options.launchRunId, limit) as JobLog[];
  }
  if (options?.jobRunId) {
    return getDb()
      .prepare(
        `SELECT * FROM job_logs WHERE job_run_id = ? ORDER BY created_at DESC LIMIT ?`
      )
      .all(options.jobRunId, limit) as JobLog[];
  }
  return getDb()
    .prepare(`SELECT * FROM job_logs ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as JobLog[];
}

export function getDashboardStats(): {
  totalPrepared: number;
  failedLaunchRuns: number;
  lastRun: JobRun | null;
} {
  const totalPrepared = (
    getDb().prepare(`SELECT COUNT(*) as c FROM prepared_launches`).get() as { c: number }
  ).c;
  const failedLaunchRuns = (
    getDb()
      .prepare(
        `SELECT COUNT(*) as c FROM launch_runs
         WHERE step_drive = 'failed' OR step_templates = 'failed'
           OR step_briefing = 'failed' OR step_whatsapp = 'failed'`
      )
      .get() as { c: number }
  ).c;
  const lastRun = getDb()
    .prepare(`SELECT * FROM job_runs ORDER BY started_at DESC LIMIT 1`)
    .get() as JobRun | null;
  return { totalPrepared, failedLaunchRuns, lastRun };
}

export function listFailedLaunchRuns(limit = 20): LaunchRun[] {
  return getDb()
    .prepare(
      `SELECT * FROM launch_runs
       WHERE step_drive = 'failed' OR step_templates = 'failed'
         OR step_briefing = 'failed' OR step_whatsapp = 'failed'
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(limit) as LaunchRun[];
}
