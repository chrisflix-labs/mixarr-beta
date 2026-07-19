import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "../prisma";
import { APP_VERSION_NUMBER } from "../appVersion";
import { isUserAdmin } from "../auth";
import { createPlaylistRecipeData, portableRecipeFromRecord, updatePlaylistRecipeData, type PlaylistRecipeInput } from "../playlistRecipes";
import { safeRecipeFilename } from "../mixRecipes/transfer";
import { validateArtwork } from "../mixRecipes/archive";
import {
  COMMUNITY_FORMAT_VERSION, COMMUNITY_RECIPE_FORMAT, buildCommunityBundle, buildCommunityJson, checksumCommunityDocument, compareVersions,
  communityError, communityManifestSchema, decodeShareCode, encodeShareCode, parseCommunityBundle, parseCommunityJson,
  safeDisplayUrl, validateCommunityDocument, type CommunityDocument, type CommunityPreview,
  validateCommunityImage,
} from "./core";
import { fetchCommunityRecipe, normalizeCommunitySourceUrl } from "./url";

const STAGE_TTL_MS = 30 * 60 * 1000;
const OFFICIAL_INDEX_TTL_MS = 15 * 60 * 1000;
let officialIndexCache: { expires: number; value: unknown; refreshedAt: string } | null = null;

function json(value: unknown) { return value as Prisma.InputJsonValue; }
function recipeHash(recipe: any) { const { metadata: _metadata, format: _format, schemaVersion: _schemaVersion, recipeVersion: _recipeVersion, ...portableBehavior } = recipe || {}; return createHash("sha256").update(JSON.stringify(portableBehavior)).digest("hex"); }

function sourceTrust(sourceUrl?: string | null) {
  if (!sourceUrl) return { official: false, known: false };
  const configured = process.env.COMMUNITY_RECIPES_REPOSITORY;
  if (!configured) return { official: false, known: false };
  try {
    const source = new URL(sourceUrl); const repository = new URL(configured); const repoPath = repository.pathname.replace(/\/$/, "");
    const official = source.hostname === repository.hostname && source.pathname.startsWith(`${repoPath}/`) || source.hostname === "raw.githubusercontent.com" && source.pathname.startsWith(`${repoPath.replace(/^\//, "")}/`);
    return { official, known: official };
  } catch { return { official: false, known: false }; }
}

async function addConflict(userId: string, preview: CommunityPreview) {
  if (!preview.manifest || !preview.recipe) return preview;
  const existing = await prisma.playlistRecipe.findFirst({ where: { userId, communityRecipeId: preview.manifest.recipeId, isArchived: false, deletedAt: null }, orderBy: { importedAt: "desc" } });
  if (!existing) return preview;
  const currentHash = recipeHash(portableRecipeFromRecord(existing)); const originalHash = existing.communityOriginalChecksum;
  preview.conflict = { recipeId: preview.manifest.recipeId, localId: existing.id, name: existing.name, version: existing.communityVersion, locallyModified: Boolean(originalHash && currentHash !== originalHash) };
  preview.messages.push({ severity: "warning", code: "EXISTING_RECIPE_CONFLICT", message: preview.conflict.locallyModified ? "A matching imported recipe has local changes. Updating it would replace those changes." : "A matching community recipe is already installed.", field: "recipeId", blocking: false });
  if (existing.communityVersion && compareVersions(preview.manifest.version, existing.communityVersion) < 0) preview.messages.push({ severity: "warning", code: "RECIPE_DOWNGRADE", message: `The incoming version ${preview.manifest.version} is older than installed version ${existing.communityVersion}.`, field: "version", blocking: false, suggestion: "Import as a copy unless you intentionally want to downgrade." });
  if (preview.trustState === "official" && preview.conflict.locallyModified) preview.trustState = "modified";
  if (preview.status === "valid") preview.status = "valid_with_warnings";
  return preview;
}

export async function stageCommunityInput(input: { userId: string; content: string | Uint8Array; filename?: string; method: CommunityPreview["importMethod"]; sourceUrl?: string | null; official?: boolean }) {
  console.info("[CommunityRecipe] Import started", { userId: input.userId, method: input.method, sourceHost: input.sourceUrl ? new URL(input.sourceUrl).hostname : null, bytes: typeof input.content === "string" ? Buffer.byteLength(input.content) : input.content.length });
  let document: CommunityDocument;
  if (typeof input.content !== "string") document = parseCommunityBundle(input.content);
  else document = input.content.trim().startsWith("MXR1:") ? decodeShareCode(input.content) : parseCommunityJson(input.content);
  const trust = sourceTrust(input.sourceUrl); const preview = await addConflict(input.userId, validateCommunityDocument(document, { sourceUrl: input.sourceUrl, importMethod: input.method, official: Boolean(input.official && trust.official), known: trust.known }));
  const stage = await prisma.recipeImportStage.create({ data: { userId: input.userId, originalFilename: (input.filename || "community-recipe").slice(0, 255), detectedFormat: COMMUNITY_RECIPE_FORMAT, formatVersion: COMMUNITY_FORMAT_VERSION, sourceDigest: preview.checksum || recipeHash(document), sanitizedPayloadJson: json({ kind: "community", document, sourceUrl: input.sourceUrl || null, method: input.method, official: preview.trustState === "official" }), previewJson: json(preview), expiresAt: new Date(Date.now() + STAGE_TTL_MS) } });
  console.info("[CommunityRecipe] Validation completed", { stageId: stage.id, status: preview.status, codes: preview.messages.map((item) => item.code), checksum: preview.checksum });
  return { stageId: stage.id, expiresAt: stage.expiresAt, preview };
}

export async function stageCommunityUrl(userId: string, rawUrl: string, official = false) {
  const normalized = normalizeCommunitySourceUrl(rawUrl); const download = await fetchCommunityRecipe(normalized.toString());
  return stageCommunityInput({ userId, content: download.kind === "zip" ? download.data : Buffer.from(download.data).toString("utf8"), filename: path.basename(new URL(download.finalUrl).pathname) || "community-recipe", method: official ? "official" : "url", sourceUrl: download.finalUrl, official });
}

function installableRecipe(document: CommunityDocument) { return { ...document.recipe, refreshPolicy: { ...document.recipe.refreshPolicy, mode: "manual" as const }, automationPolicy: { ...document.recipe.automationPolicy, enabled: false, libraryId: null } }; }

function recipeInput(document: CommunityDocument, name: string): PlaylistRecipeInput {
  const recipe = installableRecipe(document);
  return { name, description: document.manifest.description || recipe.metadata.description || null, category: recipe.metadata.category, artworkUrl: null, enabled: false, sourcePlaylistId: null, filters: recipe.generation, scoring: recipe.scoring, targets: recipe.targets, bpmFlow: recipe.bpmFlow, discovery: recipe.discovery, variety: recipe.variety, playlistIdentity: recipe.playlistIdentity, refreshPolicy: { ...recipe.refreshPolicy, mode: "manual" }, automationPolicy: { ...recipe.automationPolicy, enabled: false, libraryId: null } };
}

function communityData(document: CommunityDocument, preview: CommunityPreview, method: string, sourceUrl: string | null) {
  const m = document.manifest;
  return { communityRecipeId: m.recipeId, communityVersion: m.version, communityFormatVersion: m.formatVersion, communityAuthorName: m.author.name, communityAuthorUrl: m.author.url ? safeDisplayUrl(m.author.url) : null, communityLicense: m.license, minimumMixarrVersion: m.minimumMixarrVersion || null, communityHomepageUrl: m.homepage ? safeDisplayUrl(m.homepage) : null, communityDocumentationUrl: m.documentationUrl ? safeDisplayUrl(m.documentationUrl) : null, communitySourceUrl: m.sourceUrl ? safeDisplayUrl(m.sourceUrl) : sourceUrl ? safeDisplayUrl(sourceUrl) : null, communityTagsJson: json(m.tags), communityChangelog: document.changelog || (m.changelog && !m.changelog.endsWith(".md") ? m.changelog : null), communityImportSource: sourceUrl ? safeDisplayUrl(sourceUrl) : null, communityImportMethod: method, communityTrustState: preview.trustState, communityValidationJson: json(preview.messages), communityOriginalChecksum: recipeHash(installableRecipe(document)), communityImportedVersion: m.version, communityUpdatedAt: new Date(), portableChecksum: checksumCommunityDocument(document), importedAt: new Date(), originalImportedRecipeJson: json(document.recipe), importSchemaVersion: document.recipe.schemaVersion };
}

async function storeAssets(userId: string, recipeId: string, document: CommunityDocument) {
  if (!document.assets || !Object.keys(document.assets).length) return { artworkUrl: null, screenshots: [] as string[] };
  const directory = path.resolve(process.cwd(), "public", "uploads", "community-recipes", recipeId); await fs.mkdir(directory, { recursive: true });
  const result: Record<string, string> = {};
  for (const [sourcePath, base64] of Object.entries(document.assets)) {
    const asset = validateArtwork(new Uint8Array(Buffer.from(base64, "base64"))); const name = `${createHash("sha256").update(`${userId}:${recipeId}:${sourcePath}`).digest("hex").slice(0, 18)}.${asset.extension}`; const target = path.resolve(directory, name);
    if (!target.startsWith(`${directory}${path.sep}`)) throw communityError("ASSET_PATH", "Managed asset destination is unsafe."); await fs.writeFile(target, asset.data); result[sourcePath] = `/uploads/community-recipes/${recipeId}/${name}`;
  }
  return { artworkUrl: document.manifest.artwork ? result[document.manifest.artwork] || null : null, screenshots: document.manifest.screenshots.map((item) => result[item]).filter(Boolean) };
}

export async function installStagedCommunityRecipe(input: { userId: string; stageId: string; name?: string; action?: "new" | "copy" | "update" | "replace"; confirmReplace?: boolean }) {
  const stage = await prisma.recipeImportStage.findFirst({ where: { id: input.stageId, userId: input.userId, status: "STAGED" } });
  if (!stage || stage.expiresAt <= new Date()) throw communityError("IMPORT_EXPIRED", "The preview expired. Validate the recipe again.", undefined, 410);
  const stored = stage.sanitizedPayloadJson as any; if (stored.kind !== "community") throw communityError("INVALID_STAGE", "This is not a community recipe preview.");
  const document = stored.document as CommunityDocument; const trust = sourceTrust(stored.sourceUrl); const preview = validateCommunityDocument(document, { sourceUrl: stored.sourceUrl, importMethod: stored.method, official: stored.official && trust.official, known: trust.known });
  if (!preview.installable) throw communityError("IMPORT_BLOCKED", preview.messages.find((item) => item.blocking)?.message || "The recipe is blocked.");
  const existing = await prisma.playlistRecipe.findFirst({ where: { userId: input.userId, communityRecipeId: document.manifest.recipeId, isArchived: false, deletedAt: null } }); const action = input.action || (existing ? "copy" : "new");
  if (!["new", "copy", "update", "replace"].includes(action)) throw communityError("INVALID_ACTION", "Choose a supported recipe conflict action.");
  if (["update", "replace"].includes(action) && (!existing || input.confirmReplace !== true)) throw communityError("REPLACE_CONFIRMATION_REQUIRED", "Updating or replacing an installed recipe requires explicit confirmation.", undefined, 409);
  if (action === "replace" && !(await isUserAdmin(input.userId))) throw communityError("PERMISSION_DENIED", "Administrator permission is required to replace a recipe.", undefined, 403);
  const requestedName = (input.name || document.manifest.name).trim().slice(0, 120); if (!requestedName) throw communityError("INVALID_NAME", "A local recipe name is required.");
  const names = await prisma.playlistRecipe.findMany({ where: { userId: input.userId, isArchived: false, deletedAt: null }, select: { name: true } }); let finalName = requestedName;
  if ((action === "new" || action === "copy") && names.some((item) => item.name.toLowerCase() === finalName.toLowerCase())) finalName = `${requestedName.slice(0, 108)} (Community)`;
  const metadata = communityData(document, preview, stored.method, stored.sourceUrl);
  const saved = existing && (action === "update" || action === "replace") ? await prisma.playlistRecipe.update({ where: { id: existing.id }, data: { ...updatePlaylistRecipeData(recipeInput(document, input.name || existing.name), existing), ...metadata } }) : await prisma.playlistRecipe.create({ data: { ...createPlaylistRecipeData(input.userId, recipeInput(document, finalName)), ...metadata } });
  const assets = await storeAssets(input.userId, saved.id, document); if (assets.artworkUrl || assets.screenshots.length) await prisma.playlistRecipe.update({ where: { id: saved.id }, data: { artworkUrl: assets.artworkUrl, communityScreenshotsJson: json(assets.screenshots) } });
  await prisma.recipeImportStage.update({ where: { id: stage.id }, data: { status: "IMPORTED", sanitizedPayloadJson: json({ consumed: true, checksum: preview.checksum }), previewJson: json({ consumed: true }) } });
  console.info("[CommunityRecipe] Recipe installed", { userId: input.userId, recipeId: saved.id, communityRecipeId: document.manifest.recipeId, version: document.manifest.version, method: stored.method, trustState: preview.trustState, action });
  return { recipeId: saved.id, name: saved.name, action, enabled: false };
}

function manifestFromRecord(record: any, metadata: Partial<z.input<typeof communityManifestSchema>> = {}) {
  const recipe = portableRecipeFromRecord(record); const id = metadata.recipeId || record.communityRecipeId || `local.mixarr.${safeRecipeFilename(record.name)}`;
  return communityManifestSchema.parse({ format: COMMUNITY_RECIPE_FORMAT, formatVersion: COMMUNITY_FORMAT_VERSION, recipeId: id, name: metadata.name || record.name, version: metadata.version || record.communityVersion || "1.0.0", description: metadata.description ?? record.description ?? "", author: metadata.author || { name: record.communityAuthorName || "Mixarr user", url: record.communityAuthorUrl || null }, license: metadata.license || record.communityLicense || "Unlicense", minimumMixarrVersion: metadata.minimumMixarrVersion || APP_VERSION_NUMBER, homepage: metadata.homepage || record.communityHomepageUrl || null, documentationUrl: metadata.documentationUrl || record.communityDocumentationUrl || null, sourceUrl: metadata.sourceUrl || record.communitySourceUrl || null, supportUrl: metadata.supportUrl || null, tags: metadata.tags || record.communityTagsJson || [], artwork: null, screenshots: [], changelog: metadata.changelog || record.communityChangelog || null, recipe: "recipe.json" });
}

export async function exportCommunityRecipe(input: { userId: string; recipeId: string; type: "json" | "bundle" | "code"; metadata?: Record<string, unknown> }) {
  const record = await prisma.playlistRecipe.findFirst({ where: { id: input.recipeId, userId: input.userId, isArchived: false, deletedAt: null } }); if (!record) throw communityError("NOT_FOUND", "Recipe not found.", undefined, 404);
  const document: CommunityDocument = { manifest: manifestFromRecord(record, input.metadata || {}), recipe: portableRecipeFromRecord(record), changelog: typeof input.metadata?.changelog === "string" ? input.metadata.changelog : record.communityChangelog };
  const binaryAssets: Record<string, Uint8Array> = {};
  if (input.type === "bundle") {
    const sourceAssets = [record.artworkUrl, ...(Array.isArray(record.communityScreenshotsJson) ? record.communityScreenshotsJson : [])].filter((value): value is string => typeof value === "string" && value.startsWith("/uploads/"));
    for (let index = 0; index < sourceAssets.length; index += 1) {
      const source = path.resolve(process.cwd(), "public", sourceAssets[index].replace(/^\/+/, "")); const root = path.resolve(process.cwd(), "public", "uploads"); if (!source.startsWith(`${root}${path.sep}`)) continue;
      try { const asset = validateCommunityImage(new Uint8Array(await fs.readFile(source))); const target = index === 0 && sourceAssets[index] === record.artworkUrl ? `artwork/cover.${asset.extension}` : `screenshots/screenshot-${index + 1}.${asset.extension}`; binaryAssets[target] = asset.data; if (target.startsWith("artwork/")) document.manifest.artwork = target; else document.manifest.screenshots.push(target); } catch { /* Omit missing or invalid local assets from portable exports. */ }
    }
  }
  const preview = validateCommunityDocument(document, { importMethod: "paste" }); if (!preview.installable) throw communityError("EXPORT_BLOCKED", preview.messages.find((item) => item.blocking)?.message || "Export blocked.");
  let content: string | Uint8Array; let contentType: string; let filename: string;
  if (input.type === "code") { content = encodeShareCode(document); contentType = "text/plain; charset=utf-8"; filename = `${safeRecipeFilename(record.name)}.mixarr-code.txt`; }
  else if (input.type === "bundle") { content = buildCommunityBundle(document, binaryAssets); contentType = "application/zip"; filename = `${safeRecipeFilename(record.name)}.mixarr-recipe.zip`; }
  else { content = buildCommunityJson(document); contentType = "application/json; charset=utf-8"; filename = `${safeRecipeFilename(record.name)}.mixarr-recipe.json`; }
  await prisma.playlistRecipe.update({ where: { id: record.id }, data: { lastExportedAt: new Date() } }); console.info("[CommunityRecipe] Recipe exported", { userId: input.userId, recipeId: record.id, type: input.type }); return { content, contentType, filename, checksum: checksumCommunityDocument(document) };
}

const officialIndexSchema = z.object({ format: z.literal("mixarr-community-index"), formatVersion: z.literal(1), recipes: z.array(z.object({ recipeId: z.string(), name: z.string(), version: z.string(), description: z.string().optional(), author: z.string().optional(), tags: z.array(z.string()).default([]), minimumMixarrVersion: z.string().optional(), path: z.string().min(1), artwork: z.string().optional() }).strict()).max(500) }).strict();

export async function loadOfficialRecipeIndex(force = false) {
  if (process.env.COMMUNITY_RECIPES_ENABLED === "false") return { enabled: false, recipes: [], refreshedAt: null };
  if (!process.env.COMMUNITY_RECIPES_REPOSITORY) return { enabled: false, recipes: [], refreshedAt: null };
  if (!force && officialIndexCache && officialIndexCache.expires > Date.now()) return { enabled: true, ...(officialIndexCache.value as object), refreshedAt: officialIndexCache.refreshedAt };
  const repository = new URL(process.env.COMMUNITY_RECIPES_REPOSITORY); const branch = (process.env.COMMUNITY_RECIPES_BRANCH || "main").replace(/[^A-Za-z0-9._/-]/g, ""); const indexPath = (process.env.COMMUNITY_RECIPES_INDEX || "index.json").replace(/^\/+/, "");
  const rawBase = repository.hostname === "github.com" ? `https://raw.githubusercontent.com${repository.pathname}/${branch}` : repository.toString().replace(/\/$/, ""); const download = await fetchCommunityRecipe(`${rawBase}/${indexPath}`); if (download.kind !== "json") throw communityError("OFFICIAL_INDEX_INVALID", "The official recipe index must be JSON.");
  let value: unknown; try { value = JSON.parse(Buffer.from(download.data).toString("utf8")); } catch { throw communityError("OFFICIAL_INDEX_INVALID", "The official recipe index is invalid JSON."); } const index = officialIndexSchema.parse(value);
  const recipes = index.recipes.map((item) => ({ ...item, tags: item.tags.slice(0, 20), importUrl: `${rawBase}/${item.path.replace(/^\/+/, "")}` })); const refreshedAt = new Date().toISOString(); officialIndexCache = { expires: Date.now() + OFFICIAL_INDEX_TTL_MS, value: { recipes }, refreshedAt }; return { enabled: true, recipes, refreshedAt };
}

export function sanitizeCommunityReport(input: { recipe: any; category: string; description?: string }) {
  const allowed = ["Invalid bundle", "Broken recipe", "Misleading description", "Incompatible recipe", "Suspicious content", "Possible secret exposure", "Unsafe link", "Copyright or attribution concern", "Other"];
  return { format: "mixarr-community-report", version: 1, recipeName: String(input.recipe.name || "Unknown").slice(0, 120), communityRecipeId: input.recipe.communityRecipeId || null, recipeVersion: input.recipe.communityVersion || null, sourceUrl: input.recipe.communitySourceUrl ? safeDisplayUrl(input.recipe.communitySourceUrl) : null, bundleChecksum: input.recipe.portableChecksum || null, validationCodes: Array.isArray(input.recipe.communityValidationJson) ? input.recipe.communityValidationJson.map((item: any) => String(item.code || "")).filter(Boolean).slice(0, 50) : [], mixarrVersion: APP_VERSION_NUMBER, importMethod: input.recipe.communityImportMethod || null, category: allowed.includes(input.category) ? input.category : "Other", description: String(input.description || "").replace(/[\u0000-\u001f]/g, " ").slice(0, 2000), moderationNotice: "Mixarr does not moderate recipes hosted outside Mixarr-controlled repositories." };
}
