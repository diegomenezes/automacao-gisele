import express from "express";
import cookieParser from "cookie-parser";
import path from "path";
import { config } from "./config";
import { getDb } from "./database";
import { startScheduler } from "./scheduler";
import { createAdminRouter } from "./admin/routes";
import { logger } from "./utils/logger";

async function main(): Promise<void> {
  getDb();
  logger.info("Database initialized");

  const app = express();

  app.use(cookieParser());
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.use("/admin", createAdminRouter());

  app.get("/", (_req, res) => {
    res.redirect("/admin");
  });

  const port = config.server.port;

  app.listen(port, () => {
    logger.info({ port }, "Server listening");
  });

  startScheduler();
  logger.info("Application started");
}

main().catch((error) => {
  logger.error({ error }, "Fatal error on startup");
  process.exit(1);
});
