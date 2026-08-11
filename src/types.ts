export type JobRunStatus = "running" | "success" | "partial" | "failed";
export type JobTrigger = "cron" | "manual";
export type StepName = "drive" | "templates" | "briefing" | "whatsapp";
export type StepStatus = "pending" | "success" | "failed" | "skipped";

export interface JobRun {
  id: string;
  trigger: JobTrigger;
  started_at: string;
  finished_at: string | null;
  status: JobRunStatus;
  events_found: number;
  events_processed: number;
  error_message: string | null;
}

export interface LaunchRun {
  id: string;
  job_run_id: string;
  specialist: string;
  specialist_config_id: string | null;
  launch_folder_name: string;
  capture_date: string;
  calendar_event_id: string | null;
  calendar_event_title: string | null;
  drive_folder_id: string | null;
  drive_folder_url: string | null;
  briefing_file_id: string | null;
  step_drive: StepStatus;
  step_templates: StepStatus;
  step_briefing: StepStatus;
  step_whatsapp: StepStatus;
  error_message: string | null;
  error_stack: string | null;
  created_at: string;
}

export interface PreparedLaunch {
  id: string;
  specialist: string;
  specialist_config_id: string | null;
  launch_folder_name: string;
  capture_date: string;
  calendar_event_id: string | null;
  prepared_at: string;
}

export interface JobLog {
  id: string;
  job_run_id: string | null;
  launch_run_id: string | null;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  metadata: string | null;
  created_at: string;
}

export interface CaptureEvent {
  eventId: string;
  title: string;
  specialistLabel: string;
  captureDate: Date;
}

export interface LaunchAssetsConfig {
  links_file_template: string;
  static_captacao_template: string;
  static_lembrete_template: string;
  static_carrinho_template: string;
  video_captacao_template: string;
}

export interface SpecialistConfig {
  id: string;
  name: string;
  calendar_aliases: string[];
  drive_root_folder_id: string;
  path_segments: string[];
  folder_name_template: string;
  folder_parse_regex: string;
  increment_group: number;
  initial_number: number;
  template_copy_id: string | null;
  launch_assets: LaunchAssetsConfig | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface LaunchFolderPlan {
  folderName: string;
  nextNumber: number;
  previousFolderId: string | null;
  previousFolderName: string | null;
  copyParentFolderId: string;
  resolvedPath: string[];
}
