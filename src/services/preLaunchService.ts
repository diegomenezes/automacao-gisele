import {
  addJobLog,
  createJobRun,
  createLaunchRun,
  getLaunchRun,
  isCapturePrepared,
  markLaunchPrepared,
  updateJobRun,
  updateLaunchRun,
  updateLaunchStep,
} from "../database";
import { fetchCaptureEventById, fetchUpcomingCaptureEvents } from "../calendar";
import {
  copyCopyTemplateToFolder,
  ensureLaunchFolder,
  findFirstGoogleDocInFolder,
  resolveCopyTemplateId,
  uploadTextFile,
} from "../drive";
import { computeNextLaunchFolder } from "../drive/launchNaming";
import { exportGoogleDocAsText } from "../docs";
import { generateLaunchBriefing, NO_PREVIOUS_LAUNCH_MESSAGE } from "../ai";
import { sendPreLaunchNotification } from "../whatsapp";
import { toISODate } from "../utils/date";
import { logger } from "../utils/logger";
import type { CaptureEvent, JobTrigger, LaunchRun, SpecialistConfig, StepName, StepStatus } from "../types";
import {
  getSpecialistConfigById,
  getSpecialistConfigByName,
  resolveSpecialistForTitle,
} from "./specialistResolver";

export interface RunOptions {
  trigger: JobTrigger;
  events?: CaptureEvent[];
  skipPreparedCheck?: boolean;
  retryLaunchRunId?: string;
}

export interface RunResult {
  jobRunId: string;
  status: "success" | "partial" | "failed";
  eventsFound: number;
  eventsProcessed: number;
}

async function runStep<T>(
  launchRunId: string,
  jobRunId: string,
  step: StepName,
  currentStatus: StepStatus,
  fn: () => Promise<T>,
  force = false
): Promise<T | null> {
  if (currentStatus === "success" && !force) {
    addJobLog("info", `Step ${step} already completed, skipping`, {
      jobRunId,
      launchRunId,
    });
    return null;
  }

  try {
    const result = await fn();
    updateLaunchStep(launchRunId, step, "success");
    addJobLog("info", `Step ${step} completed`, { jobRunId, launchRunId });
    return result;
  } catch (error) {
    const err = error as Error;
    updateLaunchStep(launchRunId, step, "failed");
    updateLaunchRun(launchRunId, {
      error_message: err.message,
      error_stack: err.stack,
    });
    addJobLog("error", `Step ${step} failed: ${err.message}`, {
      jobRunId,
      launchRunId,
      metadata: { stack: err.stack },
    });
    throw error;
  }
}

async function resolveSpecialistConfig(event: CaptureEvent): Promise<SpecialistConfig | null> {
  return resolveSpecialistForTitle(event.title);
}

async function processCaptureEvent(
  event: CaptureEvent,
  specialistConfig: SpecialistConfig,
  jobRunId: string,
  options: { skipPreparedCheck?: boolean; retryLaunchRunId?: string }
): Promise<boolean> {
  const captureDateStr = toISODate(event.captureDate);

  if (
    !options.skipPreparedCheck &&
    isCapturePrepared({
      calendarEventId: event.eventId,
      specialistConfigId: specialistConfig.id,
      captureDate: captureDateStr,
    })
  ) {
    addJobLog("info", `Capture already prepared: ${specialistConfig.name} ${captureDateStr}`, {
      jobRunId,
    });
    return false;
  }

  const folderPlan = await computeNextLaunchFolder(specialistConfig);

  let launchRunId: string;
  let existingLaunchRun: LaunchRun | null = null;

  if (options.retryLaunchRunId) {
    launchRunId = options.retryLaunchRunId;
    existingLaunchRun = getLaunchRun(launchRunId);
    if (!existingLaunchRun) {
      throw new Error("Launch run not found for retry");
    }
  } else {
    const launchRun = createLaunchRun(jobRunId, {
      specialist: specialistConfig.name,
      specialistConfigId: specialistConfig.id,
      launchFolderName: folderPlan.folderName,
      captureDate: captureDateStr,
      calendarEventId: event.eventId,
      calendarEventTitle: event.title,
    });
    launchRunId = launchRun.id;
  }

  const stepDrive = existingLaunchRun?.step_drive ?? "pending";
  const stepTemplates = existingLaunchRun?.step_templates ?? "pending";
  const stepBriefing = existingLaunchRun?.step_briefing ?? "pending";
  const stepWhatsapp = existingLaunchRun?.step_whatsapp ?? "pending";

  let briefingDone = stepBriefing === "success";
  const folderName =
    existingLaunchRun?.launch_folder_name ?? folderPlan.folderName;

  try {
    const launchFolder = await runStep(
      launchRunId,
      jobRunId,
      "drive",
      stepDrive,
      () => ensureLaunchFolder(folderPlan.copyParentFolderId, folderName),
      !!options.retryLaunchRunId
    ) ?? await ensureLaunchFolder(folderPlan.copyParentFolderId, folderName);

    updateLaunchRun(launchRunId, {
      drive_folder_id: launchFolder.launchFolderId,
      drive_folder_url: launchFolder.launchFolderUrl,
      launch_folder_name: launchFolder.launchFolderName,
    });

    const templateId = resolveCopyTemplateId(specialistConfig.template_copy_id);

    await runStep(
      launchRunId,
      jobRunId,
      "templates",
      stepTemplates,
      () => copyCopyTemplateToFolder(templateId, launchFolder.launchFolderId),
      !!options.retryLaunchRunId
    );

    await runStep(
      launchRunId,
      jobRunId,
      "briefing",
      stepBriefing,
      async () => {
        let briefingContent: string;

        if (!folderPlan.previousFolderId) {
          briefingContent = NO_PREVIOUS_LAUNCH_MESSAGE;
          addJobLog("info", "No previous launch folder found", {
            jobRunId,
            launchRunId,
            metadata: { specialist: specialistConfig.name },
          });
        } else {
          const docId = await findFirstGoogleDocInFolder(folderPlan.previousFolderId);
          if (!docId) {
            briefingContent = `# Resumo do Último Lançamento\n\nNenhum Google Doc encontrado na pasta anterior (${folderPlan.previousFolderName}).`;
          } else {
            const copyText = await exportGoogleDocAsText(docId);
            briefingContent = await generateLaunchBriefing(copyText);
          }
        }

        const fileId = await uploadTextFile(
          launchFolder.launchFolderId,
          "Resumo do Último Lançamento.md",
          briefingContent
        );
        updateLaunchRun(launchRunId, { briefing_file_id: fileId });
        briefingDone = true;
        return fileId;
      },
      !!options.retryLaunchRunId
    );

    await runStep(
      launchRunId,
      jobRunId,
      "whatsapp",
      stepWhatsapp,
      () =>
        sendPreLaunchNotification({
          captureDate: event.captureDate,
          specialistName: specialistConfig.name,
          launchFolderName: launchFolder.launchFolderName,
          checklist: {
            drive: true,
            templates: true,
            briefing: briefingDone,
          },
        }),
      !!options.retryLaunchRunId
    );

    markLaunchPrepared({
      specialist: specialistConfig.name,
      specialistConfigId: specialistConfig.id,
      launchFolderName: launchFolder.launchFolderName,
      captureDate: captureDateStr,
      calendarEventId: event.eventId,
    });

    addJobLog(
      "info",
      `Launch prepared: ${specialistConfig.name} / ${launchFolder.launchFolderName}`,
      { jobRunId, launchRunId }
    );

    return true;
  } catch (error) {
    logger.error({ error, specialist: specialistConfig.name }, "Failed to process capture event");
    return false;
  }
}

export async function runPreLaunchPipeline(options: RunOptions): Promise<RunResult> {
  const jobRun = createJobRun(options.trigger);
  const jobRunId = jobRun.id;

  addJobLog("info", `Job started (trigger: ${options.trigger})`, { jobRunId });

  try {
    const events = options.events ?? await fetchUpcomingCaptureEvents();

    updateJobRun(jobRunId, { events_found: events.length });
    addJobLog("info", `Found ${events.length} capture event(s) in window`, {
      jobRunId,
      metadata: { count: events.length },
    });

    let processed = 0;
    let successes = 0;
    let failures = 0;

    for (const event of events) {
      processed++;

      const specialistConfig = await resolveSpecialistConfig(event);
      if (!specialistConfig) {
        addJobLog("warn", `No specialist config for event: ${event.title}`, {
          jobRunId,
          metadata: { eventId: event.eventId },
        });
        failures++;
        continue;
      }

      const captureDateStr = toISODate(event.captureDate);
      const alreadyPrepared = isCapturePrepared({
        calendarEventId: event.eventId,
        specialistConfigId: specialistConfig.id,
        captureDate: captureDateStr,
      });

      const ok = await processCaptureEvent(event, specialistConfig, jobRunId, {
        skipPreparedCheck: options.skipPreparedCheck,
        retryLaunchRunId: options.retryLaunchRunId,
      });

      if (ok) successes++;
      else if (!alreadyPrepared && !options.skipPreparedCheck) failures++;
      else if (options.skipPreparedCheck && !ok) failures++;
    }

    const status =
      failures > 0 && successes > 0 ? "partial" : failures > 0 ? "failed" : "success";

    updateJobRun(jobRunId, {
      events_processed: processed,
      finished_at: new Date().toISOString(),
      status,
    });

    addJobLog("info", `Job finished: ${successes} success, ${failures} failures`, { jobRunId });

    return {
      jobRunId,
      status,
      eventsFound: events.length,
      eventsProcessed: processed,
    };
  } catch (error) {
    const err = error as Error;
    updateJobRun(jobRunId, {
      status: "failed",
      finished_at: new Date().toISOString(),
      error_message: err.message,
    });
    addJobLog("error", `Job failed: ${err.message}`, {
      jobRunId,
      metadata: { stack: err.stack },
    });
    throw error;
  }
}

export async function retryLaunchRun(launchRunId: string): Promise<RunResult> {
  const launchRun = getLaunchRun(launchRunId);
  if (!launchRun) {
    throw new Error("Launch run not found");
  }

  const specialistConfig = launchRun.specialist_config_id
    ? await getSpecialistConfigById(launchRun.specialist_config_id)
    : await getSpecialistConfigByName(launchRun.specialist);

  if (!specialistConfig) {
    throw new Error(`Specialist config not found for: ${launchRun.specialist}`);
  }

  const captureDate = new Date(launchRun.capture_date + "T12:00:00");

  const event: CaptureEvent = {
    eventId: launchRun.calendar_event_id ?? `manual-${launchRun.id}`,
    title: launchRun.calendar_event_title ?? `CAPTAÇÃO - ${launchRun.specialist}`,
    specialistLabel: launchRun.specialist,
    captureDate,
  };

  const jobRun = createJobRun("manual");
  const jobRunId = jobRun.id;

  addJobLog("info", `Retry started for launch run ${launchRunId}`, {
    jobRunId,
    launchRunId,
  });

  const ok = await processCaptureEvent(event, specialistConfig, jobRunId, {
    skipPreparedCheck: true,
    retryLaunchRunId: launchRunId,
  });

  updateJobRun(jobRunId, {
    events_found: 1,
    events_processed: 1,
    finished_at: new Date().toISOString(),
    status: ok ? "success" : "failed",
  });

  return {
    jobRunId,
    status: ok ? "success" : "failed",
    eventsFound: 1,
    eventsProcessed: 1,
  };
}

export async function triggerManualLaunch(data: {
  specialistConfigId?: string;
  specialist?: string;
  captureDate: string;
  calendarEventId?: string;
}): Promise<RunResult> {
  let event: CaptureEvent;
  let specialistConfig: SpecialistConfig | null = null;

  if (data.calendarEventId) {
    const fetched = await fetchCaptureEventById(data.calendarEventId);
    if (!fetched) {
      throw new Error("Calendar event not found or not a capture event");
    }
    event = fetched;
    specialistConfig = await resolveSpecialistForTitle(event.title);
  } else {
    const captureDate = new Date(data.captureDate + "T12:00:00");
    const specialistName = data.specialist?.trim();
    if (!specialistName && !data.specialistConfigId) {
      throw new Error("specialist or specialistConfigId required");
    }

    specialistConfig = data.specialistConfigId
      ? await getSpecialistConfigById(data.specialistConfigId)
      : await getSpecialistConfigByName(specialistName!);

    if (!specialistConfig) {
      throw new Error("Specialist config not found");
    }

    event = {
      eventId: `manual-${Date.now()}`,
      title: `CAPTAÇÃO - ${specialistConfig.name}`,
      specialistLabel: specialistConfig.name,
      captureDate,
    };
  }

  if (!specialistConfig) {
    specialistConfig = await resolveSpecialistForTitle(event.title);
  }

  if (!specialistConfig) {
    throw new Error(`No specialist config matches event: ${event.title}`);
  }

  return runPreLaunchPipeline({
    trigger: "manual",
    events: [event],
    skipPreparedCheck: true,
  });
}
