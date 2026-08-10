import cron from "node-cron";
import { config } from "../config";
import { runPreLaunchPipeline } from "../services/preLaunchService";
import { logger } from "../utils/logger";

export function startScheduler(): void {
  const schedule = config.scheduler.cronSchedule;

  if (!cron.validate(schedule)) {
    throw new Error(`Invalid CRON_SCHEDULE: ${schedule}`);
  }

  cron.schedule(
    schedule,
    async () => {
      logger.info({ schedule }, "Cron job triggered");
      try {
        const result = await runPreLaunchPipeline({ trigger: "cron" });
        logger.info(result, "Cron job completed");
      } catch (error) {
        logger.error({ error }, "Cron job failed");
      }
    },
    {
      timezone: config.scheduler.timezone,
    }
  );

  logger.info(
    { schedule, timezone: config.scheduler.timezone },
    "Scheduler started"
  );
}
