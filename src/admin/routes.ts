import { Router, Request, Response } from "express";
import path from "path";
import ejs from "ejs";
import { config } from "../config";
import {
  getDashboardStats,
  getJobRun,
  getLaunchRun,
  isCapturePrepared,
  listFailedLaunchRuns,
  listJobLogs,
  listJobRuns,
  listLaunchRunsByJob,
} from "../database";
import {
  createSpecialistConfig,
  deleteSpecialistConfig,
  getSpecialistConfig,
  listSpecialistConfigs,
  updateSpecialistConfig,
} from "../database/specialists";
import { fetchUpcomingCaptureEvents } from "../calendar";
import {
  retryLaunchRun,
  runPreLaunchPipeline,
  triggerManualLaunch,
} from "../services/preLaunchService";
import { resolveSpecialistForTitle } from "../services/specialistResolver";
import { previewLaunchFolder } from "../drive/launchNaming";
import { formatDateBR, toISODate } from "../utils/date";
import {
  createSessionToken,
  clearSessionCookie,
  requireAuth,
  setSessionCookie,
} from "./middleware/auth";
import {
  fetchEvolutionGroups,
  getConnectionState,
  isEvolutionConfigured,
} from "../whatsapp/evolutionClient";
import { sendTestMessage } from "../whatsapp";
import type { LaunchAssetsConfig, SpecialistConfig } from "../types";

const viewsPath = path.join(__dirname, "views");

const emptySpecialistForm = (): Omit<SpecialistConfig, "id" | "created_at" | "updated_at"> => ({
  name: "",
  calendar_aliases: [],
  drive_root_folder_id: "",
  path_segments: [],
  folder_name_template: "",
  folder_parse_regex: "",
  increment_group: 1,
  initial_number: 1,
  template_copy_id: null,
  launch_assets: null,
  enabled: true,
});

function parseLaunchAssetsFromBody(body: Record<string, unknown>): LaunchAssetsConfig | null {
  const links = String(body.links_file_template || "").trim();
  const staticCaptacao = String(body.static_captacao_template || "").trim();
  const staticLembrete = String(body.static_lembrete_template || "").trim();
  const staticCarrinho = String(body.static_carrinho_template || "").trim();
  const videoCaptacao = String(body.video_captacao_template || "").trim();

  if (!links && !staticCaptacao && !staticLembrete && !staticCarrinho && !videoCaptacao) {
    return null;
  }

  if (!links || !staticCaptacao || !staticLembrete || !staticCarrinho || !videoCaptacao) {
    throw new Error(
      "Templates de assets incompletos: preencha links, estáticos (captação/lembrete/carrinho) e vídeo captação — ou deixe todos vazios"
    );
  }

  return {
    links_file_template: links,
    static_captacao_template: staticCaptacao,
    static_lembrete_template: staticLembrete,
    static_carrinho_template: staticCarrinho,
    video_captacao_template: videoCaptacao,
  };
}

async function renderPage(
  res: Response,
  view: string,
  data: Record<string, unknown> & { title: string; hideNav?: boolean }
): Promise<void> {
  const body = await ejs.renderFile(path.join(viewsPath, view), data);
  const html = await ejs.renderFile(path.join(viewsPath, "layout.ejs"), {
    ...data,
    body,
    hideNav: data.hideNav ?? false,
  });
  res.send(html);
}

function parseAliases(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parsePathSegments(raw: string): string[] {
  return raw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function createAdminRouter(): Router {
  const router = Router();

  router.get("/login", async (req: Request, res: Response) => {
    await renderPage(res, "login.ejs", {
      title: "Login",
      hideNav: true,
      error: null,
    });
  });

  router.post("/login", async (req: Request, res: Response) => {
    const { username, password } = req.body;
    if (username === config.admin.user && password === config.admin.password) {
      setSessionCookie(res, createSessionToken());
      res.redirect("/admin");
      return;
    }
    await renderPage(res, "login.ejs", {
      title: "Login",
      hideNav: true,
      error: "Usuário ou senha inválidos",
    });
  });

  router.post("/logout", (req: Request, res: Response) => {
    clearSessionCookie(res);
    res.redirect("/admin/login");
  });

  router.use(requireAuth);

  router.get("/", async (req: Request, res: Response) => {
    const stats = getDashboardStats();
    const failedRuns = listFailedLaunchRuns(10);

    let upcoming: Array<{
      title: string;
      specialist: string;
      captureDateStr: string;
      nextFolder: string | null;
      prepared: boolean;
    }> = [];

    try {
      const events = await fetchUpcomingCaptureEvents();
      for (const e of events) {
        const matched = await resolveSpecialistForTitle(e.title);
        const captureDateStr = toISODate(e.captureDate);
        let nextFolder: string | null = null;
        let prepared = false;

        if (matched) {
          prepared = isCapturePrepared({
            calendarEventId: e.eventId,
            specialistConfigId: matched.id,
            captureDate: captureDateStr,
          });
          try {
            const { plan } = await previewLaunchFolder(matched);
            nextFolder = plan.folderName;
          } catch {
            nextFolder = null;
          }
        }

        upcoming.push({
          title: e.title,
          specialist: e.specialistLabel,
          captureDateStr: formatDateBR(e.captureDate),
          nextFolder,
          prepared,
        });
      }
    } catch {
      upcoming = [];
    }

    let evolution: { connected: boolean; state: string } | null = null;
    if (isEvolutionConfigured()) {
      try {
        const conn = await getConnectionState();
        evolution = { connected: conn.connected, state: conn.state };
      } catch {
        evolution = { connected: false, state: "error" };
      }
    }

    await renderPage(res, "dashboard.ejs", {
      title: "Dashboard",
      stats,
      upcoming,
      failedRuns,
      evolution,
    });
  });

  router.get("/runs", async (req: Request, res: Response) => {
    const runs = listJobRuns(100);
    await renderPage(res, "runs.ejs", { title: "Histórico", runs });
  });

  router.get("/runs/:id", async (req: Request, res: Response) => {
    const run = getJobRun(req.params.id);
    if (!run) {
      res.status(404).send("Execução não encontrada");
      return;
    }
    const launchRuns = listLaunchRunsByJob(run.id);
    const logs = listJobLogs({ jobRunId: run.id });
    await renderPage(res, "run-detail.ejs", {
      title: "Detalhe execução",
      run,
      launchRuns,
      logs,
    });
  });

  router.get("/launch-runs/:id", async (req: Request, res: Response) => {
    const launchRun = getLaunchRun(req.params.id);
    if (!launchRun) {
      res.status(404).send("Lançamento não encontrado");
      return;
    }
    const logs = listJobLogs({ launchRunId: launchRun.id });
    await renderPage(res, "launch-run-detail.ejs", {
      title: "Detalhe lançamento",
      launchRun,
      logs,
    });
  });

  router.post("/launch-runs/:id/retry", async (req: Request, res: Response) => {
    try {
      await retryLaunchRun(req.params.id);
      res.redirect(`/admin/launch-runs/${req.params.id}`);
    } catch (error) {
      const err = error as Error;
      res.status(500).send(`Erro ao reprocessar: ${err.message}`);
    }
  });

  router.get("/specialists", async (req: Request, res: Response) => {
    const specialists = listSpecialistConfigs();
    await renderPage(res, "specialists-list.ejs", {
      title: "Especialistas",
      specialists,
    });
  });

  router.get("/specialists/new", async (req: Request, res: Response) => {
    await renderPage(res, "specialists-form.ejs", {
      title: "Novo especialista",
      specialist: { ...emptySpecialistForm(), id: "" },
      error: null,
    });
  });

  router.post("/specialists", async (req: Request, res: Response) => {
    try {
      createSpecialistConfig({
        name: req.body.name?.trim(),
        calendar_aliases: parseAliases(req.body.calendar_aliases || ""),
        drive_root_folder_id: req.body.drive_root_folder_id?.trim(),
        path_segments: parsePathSegments(req.body.path_segments || ""),
        folder_name_template: req.body.folder_name_template?.trim(),
        folder_parse_regex: req.body.folder_parse_regex?.trim(),
        increment_group: parseInt(req.body.increment_group, 10) || 1,
        initial_number: parseInt(req.body.initial_number, 10) || 1,
        template_copy_id: req.body.template_copy_id?.trim() || null,
        launch_assets: parseLaunchAssetsFromBody(req.body),
        enabled: req.body.enabled === "1",
      });
      res.redirect("/admin/specialists");
    } catch (error) {
      await renderPage(res, "specialists-form.ejs", {
        title: "Novo especialista",
        specialist: {
          ...emptySpecialistForm(),
          id: "",
          name: req.body.name,
          calendar_aliases: parseAliases(req.body.calendar_aliases || ""),
          drive_root_folder_id: req.body.drive_root_folder_id,
          path_segments: parsePathSegments(req.body.path_segments || ""),
          folder_name_template: req.body.folder_name_template,
          folder_parse_regex: req.body.folder_parse_regex,
          increment_group: parseInt(req.body.increment_group, 10) || 1,
          initial_number: parseInt(req.body.initial_number, 10) || 1,
          template_copy_id: req.body.template_copy_id?.trim() || null,
          launch_assets: null,
          enabled: req.body.enabled === "1",
        },
        error: (error as Error).message,
      });
    }
  });

  router.get("/specialists/:id/edit", async (req: Request, res: Response) => {
    const specialist = getSpecialistConfig(req.params.id);
    if (!specialist) {
      res.status(404).send("Especialista não encontrado");
      return;
    }
    await renderPage(res, "specialists-form.ejs", {
      title: "Editar especialista",
      specialist,
      error: null,
    });
  });

  router.post("/specialists/:id", async (req: Request, res: Response) => {
    try {
      updateSpecialistConfig(req.params.id, {
        name: req.body.name?.trim(),
        calendar_aliases: parseAliases(req.body.calendar_aliases || ""),
        drive_root_folder_id: req.body.drive_root_folder_id?.trim(),
        path_segments: parsePathSegments(req.body.path_segments || ""),
        folder_name_template: req.body.folder_name_template?.trim(),
        folder_parse_regex: req.body.folder_parse_regex?.trim(),
        increment_group: parseInt(req.body.increment_group, 10) || 1,
        initial_number: parseInt(req.body.initial_number, 10) || 1,
        template_copy_id: req.body.template_copy_id?.trim() || null,
        launch_assets: parseLaunchAssetsFromBody(req.body),
        enabled: req.body.enabled === "1",
      });
      res.redirect("/admin/specialists");
    } catch (error) {
      const specialist = getSpecialistConfig(req.params.id);
      await renderPage(res, "specialists-form.ejs", {
        title: "Editar especialista",
        specialist: specialist ?? { ...emptySpecialistForm(), id: req.params.id },
        error: (error as Error).message,
      });
    }
  });

  router.post("/specialists/:id/delete", async (req: Request, res: Response) => {
    deleteSpecialistConfig(req.params.id);
    res.redirect("/admin/specialists");
  });

  router.get("/specialists/:id/preview", async (req: Request, res: Response) => {
    const specialist = getSpecialistConfig(req.params.id);
    if (!specialist) {
      res.status(404).send("Especialista não encontrado");
      return;
    }

    let error: string | null = null;
    let preview = {
      plan: {
        folderName: "",
        nextNumber: 0,
        previousFolderId: null,
        previousFolderName: null,
        copyParentFolderId: "",
        resolvedPath: [] as string[],
      },
      existingFolders: [] as Array<{ id: string; name: string; increment: number }>,
    };

    try {
      const result = await previewLaunchFolder(specialist);
      preview = result;
    } catch (err) {
      error = (err as Error).message;
    }

    await renderPage(res, "specialists-preview.ejs", {
      title: "Preview Drive",
      specialist,
      preview: preview.plan,
      existingFolders: preview.existingFolders,
      error,
    });
  });

  router.get("/google", async (req: Request, res: Response) => {
    let upcoming: Array<{
      title: string;
      specialistLabel: string;
      captureDateStr: string;
      matched: boolean;
      matchedName: string | null;
    }> = [];
    let calendarError: string | null = null;

    try {
      const events = await fetchUpcomingCaptureEvents();
      for (const e of events) {
        const matched = await resolveSpecialistForTitle(e.title);
        upcoming.push({
          title: e.title,
          specialistLabel: e.specialistLabel,
          captureDateStr: formatDateBR(e.captureDate),
          matched: !!matched,
          matchedName: matched?.name ?? null,
        });
      }
    } catch (error) {
      calendarError = (error as Error).message;
    }

    await renderPage(res, "google.ejs", {
      title: "Google",
      calendarId: config.google.calendarId,
      impersonateUser: config.google.impersonateUser || null,
      upcoming,
      calendarError,
    });
  });

  router.get("/trigger", async (req: Request, res: Response) => {
    const specialists = listSpecialistConfigs();
    let upcoming: Array<{
      title: string;
      specialist: string;
      captureDateStr: string;
      eventId: string;
    }> = [];

    try {
      const events = await fetchUpcomingCaptureEvents();
      upcoming = events.map((e) => ({
        title: e.title,
        specialist: e.specialistLabel,
        captureDateStr: formatDateBR(e.captureDate),
        eventId: e.eventId,
      }));
    } catch {
      upcoming = [];
    }

    await renderPage(res, "trigger.ejs", {
      title: "Disparo manual",
      upcoming,
      specialists,
      message: null,
      messageType: null,
    });
  });

  router.post("/trigger", async (req: Request, res: Response) => {
    const { specialistConfigId, captureDate, calendarEventId } = req.body;

    try {
      const result = await triggerManualLaunch({
        specialistConfigId: specialistConfigId?.trim() || undefined,
        captureDate,
        calendarEventId: calendarEventId?.trim() || undefined,
      });

      const specialists = listSpecialistConfigs();
      let upcoming: Array<{
        title: string;
        specialist: string;
        captureDateStr: string;
        eventId: string;
      }> = [];

      try {
        const events = await fetchUpcomingCaptureEvents();
        upcoming = events.map((e) => ({
          title: e.title,
          specialist: e.specialistLabel,
          captureDateStr: formatDateBR(e.captureDate),
          eventId: e.eventId,
        }));
      } catch {
        upcoming = [];
      }

      await renderPage(res, "trigger.ejs", {
        title: "Disparo manual",
        upcoming,
        specialists,
        message: `Disparo executado com status: ${result.status} (job ${result.jobRunId})`,
        messageType: result.status === "failed" ? "error" : "success",
      });
    } catch (error) {
      const err = error as Error;
      await renderPage(res, "trigger.ejs", {
        title: "Disparo manual",
        upcoming: [],
        specialists: listSpecialistConfigs(),
        message: `Erro: ${err.message}`,
        messageType: "error",
      });
    }
  });

  router.get("/upcoming", async (req: Request, res: Response) => {
    try {
      const events = await fetchUpcomingCaptureEvents();
      const result = await Promise.all(
        events.map(async (e) => {
          const matched = await resolveSpecialistForTitle(e.title);
          const captureDateStr = toISODate(e.captureDate);
          return {
            eventId: e.eventId,
            title: e.title,
            specialist: e.specialistLabel,
            captureDate: e.captureDate.toISOString(),
            matchedSpecialist: matched?.name ?? null,
            prepared: matched
              ? isCapturePrepared({
                  calendarEventId: e.eventId,
                  specialistConfigId: matched.id,
                  captureDate: captureDateStr,
                })
              : false,
          };
        })
      );
      res.json(result);
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/api/run", async (req: Request, res: Response) => {
    try {
      const result = await runPreLaunchPipeline({ trigger: "manual" });
      res.json(result);
    } catch (error) {
      const err = error as Error;
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/integrations", async (req: Request, res: Response) => {
    let connection = { instance: config.evolution.instance, state: "not_configured", connected: false };
    let connectionError: string | null = null;
    let groups: Array<{ id: string; name: string }> = [];
    let groupsError: string | null = null;

    if (isEvolutionConfigured()) {
      try {
        connection = await getConnectionState();
      } catch (error) {
        connectionError = (error as Error).message;
      }

      try {
        groups = await fetchEvolutionGroups();
      } catch (error) {
        groupsError = (error as Error).message;
      }
    } else {
      connectionError = "Configure EVOLUTION_API_URL e EVOLUTION_INSTANCE no .env";
    }

    await renderPage(res, "integrations.ejs", {
      title: "Evolution API",
      evolution: {
        url: config.evolution.apiUrl,
        instance: config.evolution.instance,
        groupId: config.evolution.groupId,
      },
      connection,
      connectionError,
      groups,
      groupsError,
      message: null,
      messageType: null,
    });
  });

  router.post("/integrations/test-whatsapp", async (req: Request, res: Response) => {
    let connection = { instance: config.evolution.instance, state: "unknown", connected: false };
    let connectionError: string | null = null;
    let groups: Array<{ id: string; name: string }> = [];
    let groupsError: string | null = null;
    let message: string | null = null;
    let messageType: string | null = null;

    try {
      connection = await getConnectionState();
    } catch (error) {
      connectionError = (error as Error).message;
    }

    try {
      groups = await fetchEvolutionGroups();
    } catch (error) {
      groupsError = (error as Error).message;
    }

    try {
      await sendTestMessage(req.body.text?.trim() || undefined);
      message = "Mensagem de teste enviada com sucesso via Evolution API.";
      messageType = "success";
    } catch (error) {
      message = `Falha no envio: ${(error as Error).message}`;
      messageType = "error";
    }

    await renderPage(res, "integrations.ejs", {
      title: "Evolution API",
      evolution: {
        url: config.evolution.apiUrl,
        instance: config.evolution.instance,
        groupId: config.evolution.groupId,
      },
      connection,
      connectionError,
      groups,
      groupsError,
      message,
      messageType,
    });
  });

  return router;
}
