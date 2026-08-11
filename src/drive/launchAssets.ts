import type { LaunchAssetsConfig, SpecialistConfig } from "../types";
import { formatFolderNameFromTemplate } from "./launchNaming";
import { ensureFolderInParent, resolvePathFolder } from "./pathNavigator";
import { getDriveClient } from "./client";
import { logger } from "../utils/logger";

export type { LaunchAssetsConfig };

export interface LaunchAssetsResult {
  linksFileId: string | null;
  linksFileName: string | null;
  staticCaptacaoFolderId: string | null;
  staticLembreteFolderId: string | null;
  staticCarrinhoFolderId: string | null;
  videoCaptacaoFolderId: string | null;
}

function hasAssetsConfigured(assets: LaunchAssetsConfig | null | undefined): assets is LaunchAssetsConfig {
  return Boolean(
    assets &&
      assets.links_file_template &&
      assets.static_captacao_template &&
      assets.static_lembrete_template &&
      assets.static_carrinho_template &&
      assets.video_captacao_template
  );
}

async function findChildFolderByRegex(
  parentId: string,
  pattern: RegExp
): Promise<{ id: string; name: string } | null> {
  const drive = getDriveClient();
  const response = await drive.files.list({
    q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id, name)",
    pageSize: 200,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const match = (response.data.files ?? []).find((f) => f.id && f.name && pattern.test(f.name));
  return match?.id && match.name ? { id: match.id, name: match.name } : null;
}

async function resolveProductFolder(config: SpecialistConfig): Promise<{ id: string; name: string }> {
  if (!config.path_segments.length) {
    throw new Error("path_segments vazio — não é possível resolver pasta do produto");
  }

  const productSegment = config.path_segments[0];
  const { folder } = await resolvePathFolder(config.drive_root_folder_id, [productSegment]);
  return { id: folder.id, name: folder.name };
}

function extractLaunchNumber(name: string): number | null {
  const patterns = [/FPRO?\s*(\d+)/i, /FP\s*(\d+)/i, /(\d{1,3})\s*\)/];
  for (const pattern of patterns) {
    const match = name.match(pattern);
    if (match?.[1]) {
      const n = parseInt(match[1], 10);
      if (!Number.isNaN(n)) return n;
    }
  }
  return null;
}

async function copyPreviousLinksSpreadsheet(params: {
  linksFolderId: string;
  nextNumber: number;
  previousNumber: number | null;
  newFileName: string;
}): Promise<{ id: string; name: string; created: boolean }> {
  const drive = getDriveClient();

  const existing = await drive.files.list({
    q: `'${params.linksFolderId}' in parents and name = '${params.newFileName.replace(/'/g, "\\'")}' and trashed = false`,
    fields: "files(id, name)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  if (existing.data.files?.[0]?.id) {
    return {
      id: existing.data.files[0].id!,
      name: existing.data.files[0].name ?? params.newFileName,
      created: false,
    };
  }

  const listed = await drive.files.list({
    q: `'${params.linksFolderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
    fields: "files(id, name, mimeType, modifiedTime)",
    pageSize: 200,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const candidates = (listed.data.files ?? [])
    .filter((f) => f.id && f.name)
    .map((f) => ({
      id: f.id!,
      name: f.name!,
      number: extractLaunchNumber(f.name!),
    }))
    .filter((f) => f.number !== null) as Array<{ id: string; name: string; number: number }>;

  let source =
    params.previousNumber !== null
      ? candidates.find((c) => c.number === params.previousNumber)
      : undefined;

  if (!source && candidates.length) {
    source = candidates.sort((a, b) => b.number - a.number)[0];
  }

  if (!source) {
    throw new Error(
      `Nenhuma planilha de links anterior encontrada para copiar (próximo=${params.nextNumber})`
    );
  }

  const copied = await drive.files.copy({
    fileId: source.id,
    requestBody: {
      name: params.newFileName,
      parents: [params.linksFolderId],
    },
    supportsAllDrives: true,
    fields: "id, name",
  });

  if (!copied.data.id) {
    throw new Error(`Falha ao copiar planilha de links a partir de ${source.name}`);
  }

  logger.info(
    { from: source.name, to: params.newFileName, id: copied.data.id },
    "Links spreadsheet copied for launch"
  );

  return {
    id: copied.data.id,
    name: copied.data.name ?? params.newFileName,
    created: true,
  };
}

/**
 * Creates support assets for a launch:
 * - copy of previous links spreadsheet
 * - empty static folders: captação, lembrete, carrinho (venda)
 * - empty video folder: captação only
 */
export async function createLaunchSupportAssets(
  config: SpecialistConfig,
  nextNumber: number
): Promise<LaunchAssetsResult | null> {
  if (!hasAssetsConfigured(config.launch_assets)) {
    logger.info({ specialist: config.name }, "Launch assets not configured; skipping");
    return null;
  }

  const assets = config.launch_assets;
  const product = await resolveProductFolder(config);

  const linksFolder = await findChildFolderByRegex(product.id, /LINKS/i);
  const criativosFolder = await findChildFolderByRegex(product.id, /CRIATIVOS/i);
  if (!linksFolder) throw new Error(`Pasta LINKS não encontrada em ${product.name}`);
  if (!criativosFolder) throw new Error(`Pasta CRIATIVOS não encontrada em ${product.name}`);

  const estaticosFolder = await findChildFolderByRegex(criativosFolder.id, /EST[AÁ]TICOS/i);
  const videosFolder = await findChildFolderByRegex(criativosFolder.id, /V[IÍ]DEOS?/i);
  if (!estaticosFolder) throw new Error(`Pasta ESTÁTICOS não encontrada em ${criativosFolder.name}`);
  if (!videosFolder) throw new Error(`Pasta VÍDEOS não encontrada em ${criativosFolder.name}`);

  const staticCaptacaoParent = await findChildFolderByRegex(estaticosFolder.id, /CAPTA/i);
  const staticLembreteParent = await findChildFolderByRegex(estaticosFolder.id, /LEMBRETE/i);
  const staticCarrinhoParent = await findChildFolderByRegex(estaticosFolder.id, /CARRINHO/i);
  const videoCaptacaoParent = await findChildFolderByRegex(videosFolder.id, /CAPTA/i);

  if (!staticCaptacaoParent) throw new Error("Pasta ESTÁTICOS/CAPTAÇÃO não encontrada");
  if (!staticLembreteParent) throw new Error("Pasta ESTÁTICOS/LEMBRETE não encontrada");
  if (!staticCarrinhoParent) throw new Error("Pasta ESTÁTICOS/CARRINHO (venda) não encontrada");
  if (!videoCaptacaoParent) throw new Error("Pasta VÍDEOS/CAPTAÇÃO não encontrada");

  const linksName = formatFolderNameFromTemplate(assets.links_file_template, nextNumber);
  const staticCaptacaoName = formatFolderNameFromTemplate(assets.static_captacao_template, nextNumber);
  const staticLembreteName = formatFolderNameFromTemplate(assets.static_lembrete_template, nextNumber);
  const staticCarrinhoName = formatFolderNameFromTemplate(assets.static_carrinho_template, nextNumber);
  const videoCaptacaoName = formatFolderNameFromTemplate(assets.video_captacao_template, nextNumber);

  const links = await copyPreviousLinksSpreadsheet({
    linksFolderId: linksFolder.id,
    nextNumber,
    previousNumber: nextNumber - 1,
    newFileName: linksName,
  });

  const staticCaptacao = await ensureFolderInParent(staticCaptacaoParent.id, staticCaptacaoName);
  const staticLembrete = await ensureFolderInParent(staticLembreteParent.id, staticLembreteName);
  const staticCarrinho = await ensureFolderInParent(staticCarrinhoParent.id, staticCarrinhoName);
  const videoCaptacao = await ensureFolderInParent(videoCaptacaoParent.id, videoCaptacaoName);

  logger.info(
    {
      specialist: config.name,
      nextNumber,
      links: links.name,
      staticCaptacao: staticCaptacao.name,
      staticLembrete: staticLembrete.name,
      staticCarrinho: staticCarrinho.name,
      videoCaptacao: videoCaptacao.name,
    },
    "Launch support assets ensured"
  );

  return {
    linksFileId: links.id,
    linksFileName: links.name,
    staticCaptacaoFolderId: staticCaptacao.id,
    staticLembreteFolderId: staticLembrete.id,
    staticCarrinhoFolderId: staticCarrinho.id,
    videoCaptacaoFolderId: videoCaptacao.id,
  };
}
