import { promises as fs } from "node:fs";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import prisma from "../prisma";
import { isUserAdmin } from "../auth";
import { createPlaylistRecipeData, parsePlaylistRecipe, portableRecipeFromRecord, updatePlaylistRecipeData, type PlaylistRecipeInput } from "../playlistRecipes";
import { validateRecipe } from "./validation";
import { buildRecipeArchive, parseRecipeArchive, validateArtwork, type ValidArtwork } from "./archive";
import {
  MAX_RECIPE_ARCHIVE_BYTES,
  MAX_RECIPE_JSON_BYTES,
  RECIPE_EXPORT_FORMAT_VERSION,
  STAGED_IMPORT_TTL_MINUTES,
  addConflictAnalysis,
  assertExportIsSafe,
  buildBundleEnvelope,
  buildRecipeEnvelope,
  diagnosticForTransfer,
  parseTransferJson,
  portableRecipePayloadFromDocument,
  portableRecipePayloadFromRecord,
  publicImportPreview,
  redactBlockedCandidates,
  recipeChecksum,
  recipeContentChecksum,
  safeImportedName,
  safeRecipeFilename,
  scanSensitiveData,
  sha256,
  type ConflictAction,
  type ExistingPortableRecipe,
  type ImportCandidate,
  type ImportMode,
  type ParsedTransfer,
  type PortableArtwork,
  type PortableRecipePayload,
} from "./transfer";

type StoredRecipe = Record<string, any>;
type ImportDecision = { index: number; selected?: boolean; action?: ConflictAction; name?: string; acceptOptionalAdaptations?: boolean };

function json<T>(value: T): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function transferError(code: string, message: string, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

export function sanitizeUploadFilename(filename: string) {
  const basename = path.basename(filename.replace(/\\/g, "/")).replace(/[\x00-\x1f<>:"|?*]/g, "-").trim();
  return (basename || "mixarr-recipe-import").slice(0, 180);
}

async function localArtwork(url: string | null | undefined): Promise<ValidArtwork | null> {
  if (!url || !url.startsWith("/") || url.startsWith("//")) return null;
  const publicRoot = path.resolve(process.cwd(), "public");
  const resolved = path.resolve(publicRoot, `.${url.split(/[?#]/)[0]}`);
  if (resolved !== publicRoot && !resolved.startsWith(`${publicRoot}${path.sep}`)) return null;
  try { return validateArtwork(new Uint8Array(await fs.readFile(resolved))); } catch { return null; }
}

export async function createRecipeExport(input: { userId: string; recipeIds: string[]; includeArtwork?: boolean; archive?: boolean; excludeInvalid?: boolean }) {
  const ids = Array.from(new Set(input.recipeIds.filter(Boolean)));
  if (!ids.length) throw transferError("NO_RECIPES_FOUND", "Select at least one recipe to export.");
  if (ids.length > 100) throw transferError("FILE_TOO_LARGE", "A bundle can contain at most 100 recipes.");
  console.info("[RecipeTransfer] Export started", { recipeCount: ids.length, archive: input.archive === true });
  const records = await prisma.playlistRecipe.findMany({ where: { id: { in: ids }, userId: input.userId, isArchived: false } });
  if (records.length !== ids.length) throw transferError("PERMISSION_DENIED", "One or more selected recipes are unavailable.", 403);
  const ordered = records.sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  const warnings: string[] = [];
  const assets = new Map<string, ValidArtwork>();
  const payloads: PortableRecipePayload[] = [];
  const validRecords: StoredRecipe[] = [];
  for (const record of ordered) {
    try {
      const document = portableRecipeFromRecord(record);
      const validation = validateRecipe(document);
      if (!validation.valid) throw new Error(validation.errors[0]?.message || "Recipe validation failed.");
      let artwork: PortableArtwork = { included: false, reference: null };
      if (input.archive && input.includeArtwork && record.artworkUrl) {
        const asset = await localArtwork(record.artworkUrl);
        if (asset) {
          const reference = `artwork/${safeRecipeFilename(record.name)}-${asset.checksum.slice(0, 10)}.${asset.extension}`;
          assets.set(reference, asset);
          artwork = { included: true, reference, mimeType: asset.mimeType, checksum: asset.checksum };
        } else warnings.push(`Artwork for "${record.name}" could not be included; the recipe remains portable without it.`);
      }
      payloads.push(portableRecipePayloadFromDocument(document, artwork));
      validRecords.push(record);
    } catch (error) {
      if (!input.excludeInvalid || ids.length === 1) throw transferError("INVALID_RECIPE_SCHEMA", `Recipe "${record.name}" is invalid: ${error instanceof Error ? error.message : "validation failed"}`);
      warnings.push(`Excluded invalid recipe "${record.name}".`);
    }
  }
  if (!payloads.length) throw transferError("NO_RECIPES_FOUND", "No valid recipes remain to export.");
  const single = payloads.length === 1 && ids.length === 1;
  const envelope = single ? buildRecipeEnvelope(payloads[0]) : buildBundleEnvelope(payloads);
  assertExportIsSafe(envelope);
  const output = input.archive ? buildRecipeArchive(envelope, assets) : JSON.stringify(envelope, null, 2);
  const type = input.archive ? (single ? "RECIPE_ARCHIVE" : "BUNDLE_ARCHIVE") : single ? "SINGLE_JSON" : "BUNDLE_JSON";
  const filename = input.archive
    ? single ? `${safeRecipeFilename(payloads[0].name)}.mixarr-recipe.zip` : `mixarr-recipes-${new Date().toISOString().slice(0, 10)}.mixarr-bundle.zip`
    : single ? `${safeRecipeFilename(payloads[0].name)}.mixarr-recipe.json` : `mixarr-recipes-${new Date().toISOString().slice(0, 10)}.mixarr-bundle.json`;
  const history = await prisma.$transaction(async (tx) => {
    const event = await tx.recipeExportHistory.create({ data: { userId: input.userId, exportType: type, recipeCount: payloads.length, recipeNamesJson: payloads.map((item) => item.name), formatVersion: RECIPE_EXPORT_FORMAT_VERSION, includedArtwork: assets.size > 0, sanitizationResult: "PASSED", warningCount: warnings.length, status: "COMPLETED", diagnosticJson: json({ warnings, omittedLocalFields: ["database identity", "user identity", "Plex server/library/track identifiers", "playback and feedback history", "automation destination"] }) } });
    await tx.playlistRecipe.updateMany({ where: { id: { in: validRecords.map((record) => record.id) }, userId: input.userId }, data: { lastExportedAt: new Date() } });
    return event;
  });
  console.info("[RecipeTransfer] Export completed", { historyId: history.id, recipeCount: payloads.length, artworkCount: assets.size, warningCount: warnings.length });
  return { output, binary: input.archive === true, filename, recipeCount: payloads.length, formatVersion: RECIPE_EXPORT_FORMAT_VERSION, artworkCount: assets.size, warnings, historyId: history.id };
}

async function existingPortableRecipes(userId: string): Promise<ExistingPortableRecipe[]> {
  const records = await prisma.playlistRecipe.findMany({ where: { userId, isArchived: false } });
  return records.flatMap((record) => {
    try {
      const portable = portableRecipePayloadFromRecord(record);
      return [{ id: record.id, name: record.name, checksum: record.portableChecksum || recipeChecksum(portable), contentChecksum: record.portableContentChecksum || recipeContentChecksum(portable) }];
    } catch { return []; }
  });
}

async function addDestinationCapabilityAnalysis(userId: string, parsed: ParsedTransfer) {
  const scope = { library: { server: { userId } }, syncStatus: "active", deletedAt: null } as const;
  const [tracks, bpmTracks, energyTracks, moodTracks, popularityTracks] = await Promise.all([
    prisma.track.count({ where: scope }),
    prisma.track.count({ where: { ...scope, effectiveBpm: { not: null } } }),
    prisma.track.count({ where: { ...scope, audioFeature: { is: { energy: { not: null } } } } }),
    prisma.track.count({ where: { ...scope, tags: { some: { type: "mood" } } } }),
    prisma.track.count({ where: { ...scope, popularity: { isNot: null } } }),
  ]).catch(() => [0, 0, 0, 0, 0]);
  for (const candidate of parsed.candidates) {
    const capabilityWarnings: Array<[boolean, string, string]> = [
      [tracks === 0, "destination.library", "No synced destination tracks are available, so metadata compatibility cannot be fully verified."],
      [(candidate.portable.settings.bpmFlow.mode !== "DISABLED" || candidate.portable.settings.bpmFlow.minimumBpm != null || candidate.portable.settings.bpmFlow.maximumBpm != null) && bpmTracks === 0, "settings.bpmFlow", "The destination has no analyzed BPM metadata. The setting is retained, but BPM analysis is recommended before generation."],
      [(candidate.portable.settings.targets.minimumEnergy != null || candidate.portable.settings.targets.maximumEnergy != null || candidate.portable.settings.targets.targetEnergy != null) && energyTracks === 0, "settings.targets.energy", "The destination has no analyzed energy metadata. The setting is retained, but audio analysis is recommended before generation."],
      [candidate.portable.settings.targets.selectedMoods.length > 0 && moodTracks === 0, "settings.targets.selectedMoods", "The destination has no track-level mood tags. Mood targets are retained and may use configured fallback behavior."],
      [(candidate.portable.settings.scoring.popularityWeight > 0 || candidate.portable.settings.discovery.level !== "low") && popularityTracks === 0, "settings.discovery", "The destination has no popularity metadata. Discovery settings are retained and will use neutral/fallback behavior where needed."],
    ];
    for (const [applies, pathName, message] of capabilityWarnings) {
      if (!applies) continue;
      candidate.compatibility.push({ path: pathName, classification: "adaptable", message });
      candidate.validationWarnings.push({ path: pathName, code: "destination_capability_missing", message });
    }
  }
  return parsed;
}

function attachArchiveArtwork(parsed: ParsedTransfer, artwork: Map<string, ValidArtwork>) {
  for (const candidate of parsed.candidates) {
    const reference = candidate.portable.artwork.reference;
    if (!candidate.portable.artwork.included || !reference) continue;
    const asset = artwork.get(reference);
    if (!asset) {
      candidate.validationWarnings.push({ path: "artwork", code: "artwork_missing", message: "Referenced artwork is missing; the recipe can still be imported without it." });
      candidate.portable.artwork = { included: false, reference: null };
      continue;
    }
    if (candidate.portable.artwork.checksum && candidate.portable.artwork.checksum !== asset.checksum) {
      candidate.validationWarnings.push({ path: "artwork", code: "artwork_checksum_mismatch", message: "Artwork failed its checksum and will be omitted." });
      candidate.portable.artwork = { included: false, reference: null };
      continue;
    }
    candidate.artworkDataBase64 = Buffer.from(asset.data).toString("base64");
    candidate.artworkMimeType = asset.mimeType;
  }
  return parsed;
}

export async function stageRecipeImport(input: { userId: string; filename: string; content: string; encoding?: "utf8" | "base64" }) {
  const filename = sanitizeUploadFilename(input.filename);
  console.info("[RecipeTransfer] Import upload received", { filenameLength: filename.length, encoding: input.encoding || "utf8" });
  await prisma.recipeImportStage.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  let parsed: ParsedTransfer;
  if (input.encoding === "base64") {
    const data = new Uint8Array(Buffer.from(input.content, "base64"));
    if (data.length > MAX_RECIPE_ARCHIVE_BYTES) throw transferError("FILE_TOO_LARGE", "Recipe archive is too large.");
    const archive = parseRecipeArchive(data);
    parsed = parseTransferJson(archive.manifestText, data.length);
    parsed.archive = true;
    parsed.sourceDigest = sha256(data);
    attachArchiveArtwork(parsed, archive.artwork);
  } else {
    if (Buffer.byteLength(input.content, "utf8") > MAX_RECIPE_JSON_BYTES) throw transferError("FILE_TOO_LARGE", "Recipe import file is too large.", 413);
    parsed = parseTransferJson(input.content);
  }
  console.info("[RecipeTransfer] Import format detected", { format: parsed.format, formatVersion: parsed.formatVersion, recipeCount: parsed.candidates.length });
  redactBlockedCandidates(parsed);
  await addDestinationCapabilityAnalysis(input.userId, parsed);
  addConflictAnalysis(parsed, await existingPortableRecipes(input.userId));
  const preview = publicImportPreview(parsed);
  const expiresAt = new Date(Date.now() + STAGED_IMPORT_TTL_MINUTES * 60_000);
  const stage = await prisma.recipeImportStage.create({ data: { userId: input.userId, originalFilename: filename, detectedFormat: parsed.format, formatVersion: parsed.formatVersion, sourceDigest: parsed.sourceDigest, sanitizedPayloadJson: json(parsed), previewJson: json(preview), expiresAt } });
  console.info("[RecipeTransfer] Import staged", { stageId: stage.id, checksum: preview.bundleChecksumStatus || preview.recipes.map((item) => item.checksumStatus).join(","), sensitiveDataSafe: preview.recipes.every((item) => item.sensitiveDataScan.safe) });
  return { stageId: stage.id, expiresAt: stage.expiresAt, preview };
}

export async function getStagedImport(userId: string, stageId: string) {
  const stage = await prisma.recipeImportStage.findFirst({ where: { id: stageId, userId, status: "STAGED" } });
  if (!stage) throw transferError("IMPORT_EXPIRED", "The staged import is unavailable or has already been used.", 404);
  if (stage.expiresAt <= new Date()) {
    await prisma.recipeImportStage.update({ where: { id: stage.id }, data: { status: "EXPIRED" } });
    throw transferError("IMPORT_EXPIRED", "The staged import expired. Select the file again.", 410);
  }
  return { stageId: stage.id, filename: stage.originalFilename, expiresAt: stage.expiresAt, preview: stage.previewJson };
}

export async function cancelStagedImport(userId: string, stageId: string) {
  const updated = await prisma.recipeImportStage.updateMany({ where: { id: stageId, userId, status: "STAGED" }, data: { status: "CANCELLED", sanitizedPayloadJson: json({ cancelled: true }), previewJson: json({ cancelled: true }) } });
  if (!updated.count) throw transferError("IMPORT_EXPIRED", "The staged import is unavailable.", 404);
  console.info("[RecipeTransfer] Temporary staged import removed", { stageId });
  return { cancelled: true };
}

function inputFromCandidate(candidate: ImportCandidate, name: string): PlaylistRecipeInput {
  if (!candidate.normalizedRecipe) throw transferError("INVALID_RECIPE_SCHEMA", `Recipe "${candidate.portable.name}" is invalid.`);
  const recipe = candidate.normalizedRecipe;
  return {
    name,
    description: recipe.metadata.description,
    category: recipe.metadata.category,
    artworkUrl: null,
    enabled: true,
    sourcePlaylistId: null,
    filters: recipe.generation,
    scoring: recipe.scoring,
    targets: recipe.targets,
    bpmFlow: recipe.bpmFlow,
    discovery: recipe.discovery,
    variety: recipe.variety,
    playlistIdentity: recipe.playlistIdentity,
    refreshPolicy: recipe.refreshPolicy,
    automationPolicy: { ...recipe.automationPolicy, enabled: false, libraryId: null },
  };
}

function decisionFor(candidate: ImportCandidate, decisions: ImportDecision[]) {
  const requested = decisions.find((item) => item.index === candidate.index);
  const action = requested?.selected === false ? "skip" : requested?.action || candidate.recommendedAction;
  if (!["rename", "replace", "skip", "use_existing", "import"].includes(action)) throw transferError("CONFLICT_UNRESOLVED", `Recipe "${candidate.portable.name}" has an invalid conflict action.`);
  const name = (requested?.name || (action === "rename" ? candidate.proposedName : candidate.portable.name)).trim().slice(0, 120);
  if ((action === "rename" || action === "import") && !name) throw transferError("CONFLICT_UNRESOLVED", "Imported recipe names cannot be empty.");
  return { action, name } as { action: ConflictAction; name: string };
}

async function writeImportedArtwork(userId: string, recipeId: string, candidate: ImportCandidate) {
  if (!candidate.artworkDataBase64 || !candidate.artworkMimeType) return null;
  const data = new Uint8Array(Buffer.from(candidate.artworkDataBase64, "base64"));
  const asset = validateArtwork(data);
  const filename = `${safeRecipeFilename(candidate.portable.name)}-${sha256(`${userId}:${recipeId}`).slice(0, 12)}.${asset.extension}`;
  const directory = path.resolve(process.cwd(), "public", "uploads", "recipe-artwork");
  await fs.mkdir(directory, { recursive: true });
  const target = path.resolve(directory, filename);
  if (!target.startsWith(`${directory}${path.sep}`)) throw transferError("ARTWORK_INVALID", "Artwork filename is unsafe.");
  await fs.writeFile(target, asset.data);
  const artworkUrl = `/uploads/recipe-artwork/${filename}`;
  await prisma.playlistRecipe.updateMany({ where: { id: recipeId, userId }, data: { artworkUrl } });
  return artworkUrl;
}

function revalidateCandidate(candidate: ImportCandidate) {
  if (recipeChecksum(candidate.portable) !== candidate.calculatedChecksum) throw transferError("CHECKSUM_MISMATCH", `Staged recipe "${candidate.portable.name}" failed integrity revalidation.`);
  if (!candidate.scan.safe || !scanSensitiveData(candidate.portable).safe) throw transferError("SENSITIVE_DATA_DETECTED", `Recipe "${candidate.portable.name}" contains private data.`);
  if (!candidate.normalizedRecipe) throw transferError("INVALID_RECIPE_SCHEMA", `Recipe "${candidate.portable.name}" is invalid.`);
  const result = validateRecipe(candidate.normalizedRecipe);
  if (!result.valid) throw transferError("INVALID_RECIPE_SCHEMA", result.errors[0]?.message || "Recipe validation failed.");
  if (["mismatched", "malformed", "unsupported"].includes(candidate.checksumStatus)) throw transferError("CHECKSUM_MISMATCH", `Recipe "${candidate.portable.name}" has invalid integrity data.`);
}

export async function confirmRecipeImport(input: { userId: string; stageId: string; mode?: ImportMode; decisions?: ImportDecision[] }) {
  const mode: ImportMode = input.mode === "independent" ? "independent" : "atomic";
  const decisions = input.decisions || [];
  const stage = await prisma.recipeImportStage.findFirst({ where: { id: input.stageId, userId: input.userId, status: "STAGED" } });
  if (!stage || stage.expiresAt <= new Date()) throw transferError("IMPORT_EXPIRED", "The staged import expired. Select the file again.", 410);
  const parsed = stage.sanitizedPayloadJson as unknown as ParsedTransfer;
  const selected = parsed.candidates.map((candidate) => ({ candidate, decision: decisionFor(candidate, decisions) })).filter((item) => item.decision.action !== "skip");
  const admin = await isUserAdmin(input.userId);
  if (selected.some((item) => item.decision.action === "replace") && !admin) throw transferError("PERMISSION_DENIED", "Administrator permission is required to replace an existing recipe.", 403);
  if (!selected.length) throw transferError("NO_RECIPES_FOUND", "No recipes are selected for import.");
  selected.forEach(({ candidate }) => revalidateCandidate(candidate));
  const history = await prisma.recipeImportHistory.create({ data: { userId: input.userId, originalFilename: stage.originalFilename, detectedFormat: stage.detectedFormat, formatVersion: stage.formatVersion, importMode: mode.toUpperCase(), recipeCount: parsed.candidates.length, checksumResult: parsed.candidates.every((item) => item.checksumStatus === "valid") ? "VALID" : parsed.candidates.some((item) => item.checksumStatus === "missing") ? "MISSING_COMPATIBLE" : "FAILED", sensitiveDataScanResult: parsed.candidates.every((item) => item.scan.safe) ? "PASSED" : "BLOCKED", warningCount: parsed.candidates.reduce((total, item) => total + item.validationWarnings.length + item.adaptations.length + item.unsupported.length, 0), errorCount: parsed.candidates.reduce((total, item) => total + item.validationErrors.length, 0), resultSummaryJson: json({ pending: true }), status: "RUNNING" } });
  console.info("[RecipeTransfer] Import confirmed", { stageId: stage.id, historyId: history.id, mode, selectedCount: selected.length });
  const results: Array<{ index: number; name: string; action: string; recipeId?: string; error?: string }> = [];
  const artworkWrites: Array<{ recipeId: string; candidate: ImportCandidate }> = [];
  const executeOne = async (tx: Prisma.TransactionClient, candidate: ImportCandidate, decision: { action: ConflictAction; name: string }) => {
    const identicalConflict = candidate.conflicts.find((item) => ["identical_checksum", "equivalent_content"].includes(item.type) && item.existingRecipeId);
    const nameConflict = candidate.conflicts.find((item) => ["exact_name", "normalized_name"].includes(item.type) && item.existingRecipeId);
    if (decision.action === "use_existing") {
      if (!identicalConflict?.existingRecipeId) throw transferError("CONFLICT_UNRESOLVED", "Use Existing requires identical or equivalent local recipe content.");
      results.push({ index: candidate.index, name: identicalConflict.existingRecipeName || candidate.portable.name, action: "already_present", recipeId: identicalConflict.existingRecipeId });
      return;
    }
    if (decision.action === "replace") {
      if (!nameConflict?.existingRecipeId) throw transferError("CONFLICT_UNRESOLVED", "Replace requires an exact or normalized-name local recipe conflict.");
      const existing = await tx.playlistRecipe.findFirst({ where: { id: nameConflict.existingRecipeId, userId: input.userId, isArchived: false } });
      if (!existing) throw transferError("CONFLICT_UNRESOLVED", "The recipe selected for replacement no longer exists.");
      const recipeInput = inputFromCandidate(candidate, existing.name);
      recipeInput.enabled = existing.enabled;
      recipeInput.artworkUrl = candidate.artworkDataBase64 ? null : existing.artworkUrl;
      recipeInput.automationPolicy = existing.automationPolicyJson as PlaylistRecipeInput["automationPolicy"];
      const updated = await tx.playlistRecipe.update({ where: { id: existing.id }, data: { ...updatePlaylistRecipeData(recipeInput, existing), portableChecksum: candidate.calculatedChecksum, portableContentChecksum: candidate.contentChecksum, importedAt: new Date() } });
      results.push({ index: candidate.index, name: updated.name, action: "replaced", recipeId: updated.id });
      if (candidate.artworkDataBase64) artworkWrites.push({ recipeId: updated.id, candidate });
      return;
    }
    const names = await tx.playlistRecipe.findMany({ where: { userId: input.userId, isArchived: false }, select: { name: true } });
    let finalName = decision.name;
    const collision = names.some((item) => item.name.normalize().toLowerCase() === finalName.normalize().toLowerCase());
    if (collision) {
      if (decision.action !== "rename") throw transferError("CONFLICT_UNRESOLVED", `A recipe named "${finalName}" already exists.`);
      finalName = safeImportedName(candidate.portable.name, names.map((item) => item.name));
    }
    const recipeInput = inputFromCandidate(candidate, finalName);
    const created = await tx.playlistRecipe.create({ data: { ...createPlaylistRecipeData(input.userId, recipeInput), portableChecksum: candidate.calculatedChecksum, portableContentChecksum: candidate.contentChecksum, importedAt: new Date() } });
    results.push({ index: candidate.index, name: created.name, action: finalName === candidate.portable.name ? "imported" : "renamed", recipeId: created.id });
    if (candidate.artworkDataBase64) artworkWrites.push({ recipeId: created.id, candidate });
  };
  try {
    if (mode === "atomic") {
      await prisma.$transaction(async (tx) => { for (const item of selected) await executeOne(tx, item.candidate, item.decision); });
    } else {
      for (const item of selected) {
        try { await prisma.$transaction((tx) => executeOne(tx, item.candidate, item.decision)); }
        catch (error) { results.push({ index: item.candidate.index, name: item.candidate.portable.name, action: "failed", error: error instanceof Error ? error.message : "Import failed." }); }
      }
    }
    for (const artwork of artworkWrites) {
      try { await writeImportedArtwork(input.userId, artwork.recipeId, artwork.candidate); }
      catch (error) { results.push({ index: artwork.candidate.index, name: artwork.candidate.portable.name, action: "artwork_omitted", error: error instanceof Error ? error.message : "Artwork could not be stored." }); }
    }
    for (const candidate of parsed.candidates) {
      if (!results.some((item) => item.index === candidate.index)) results.push({ index: candidate.index, name: candidate.portable.name, action: "skipped" });
    }
    const counts = {
      imported: results.filter((item) => item.action === "imported").length,
      adapted: selected.filter((item) => item.candidate.adaptations.length > 0).length,
      replaced: results.filter((item) => item.action === "replaced").length,
      renamed: results.filter((item) => item.action === "renamed").length,
      alreadyPresent: results.filter((item) => item.action === "already_present").length,
      skipped: results.filter((item) => item.action === "skipped").length,
      failed: results.filter((item) => item.action === "failed").length,
    };
    const status = counts.failed ? (mode === "independent" ? "PARTIAL" : "FAILED") : "COMPLETED";
    const diagnostic = diagnosticForTransfer(parsed, status, { counts, results: results.map(({ recipeId: _id, ...item }) => item) });
    await prisma.$transaction([
      prisma.recipeImportHistory.update({ where: { id: history.id }, data: { completedAt: new Date(), importedCount: counts.imported, adaptedCount: counts.adapted, replacedCount: counts.replaced, renamedCount: counts.renamed, skippedCount: counts.skipped + counts.alreadyPresent, failedCount: counts.failed, resultSummaryJson: json({ counts, recipes: results.map(({ recipeId: _id, ...item }) => item) }), diagnosticJson: json(diagnostic), status } }),
      prisma.recipeImportStage.update({ where: { id: stage.id }, data: { status: "IMPORTED", sanitizedPayloadJson: json({ consumed: true, sourceDigest: stage.sourceDigest }), previewJson: json({ consumed: true }) } }),
    ]);
    console.info("[RecipeTransfer] Import completed", { historyId: history.id, status, counts });
    return { historyId: history.id, status, counts, results };
  } catch (error) {
    const diagnostic = diagnosticForTransfer(parsed, "FAILED", { errorCode: (error as Error & { code?: string }).code || "TRANSACTION_FAILED", message: error instanceof Error ? error.message : "Import failed." });
    await prisma.recipeImportHistory.update({ where: { id: history.id }, data: { completedAt: new Date(), failedCount: selected.length, errorCount: { increment: 1 }, resultSummaryJson: json({ errorCode: (error as Error & { code?: string }).code || "TRANSACTION_FAILED" }), diagnosticJson: json(diagnostic), status: "FAILED" } });
    console.warn("[RecipeTransfer] Import failed", { historyId: history.id, errorCode: (error as Error & { code?: string }).code || "TRANSACTION_FAILED" });
    throw error;
  }
}

export async function recipeTransferHistory(userId: string) {
  const [imports, exports] = await Promise.all([
    prisma.recipeImportHistory.findMany({ where: { userId }, orderBy: { startedAt: "desc" }, take: 100, select: { id: true, startedAt: true, completedAt: true, originalFilename: true, detectedFormat: true, formatVersion: true, importMode: true, recipeCount: true, importedCount: true, adaptedCount: true, replacedCount: true, renamedCount: true, skippedCount: true, failedCount: true, warningCount: true, errorCount: true, resultSummaryJson: true, status: true } }),
    prisma.recipeExportHistory.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, createdAt: true, exportType: true, recipeCount: true, recipeNamesJson: true, formatVersion: true, includedArtwork: true, sanitizationResult: true, warningCount: true, status: true, diagnosticJson: true } }),
  ]);
  return { imports, exports };
}

export async function clearRecipeTransferHistory(userId: string) {
  if (!(await isUserAdmin(userId))) throw transferError("PERMISSION_DENIED", "Administrator permission is required to clear recipe history.", 403);
  const [imports, exports] = await prisma.$transaction([prisma.recipeImportHistory.deleteMany({ where: { userId } }), prisma.recipeExportHistory.deleteMany({ where: { userId } })]);
  return { importsRemoved: imports.count, exportsRemoved: exports.count };
}

export async function recipeImportDiagnostic(userId: string, historyId: string) {
  const history = await prisma.recipeImportHistory.findFirst({ where: { id: historyId, userId }, select: { diagnosticJson: true } });
  if (!history?.diagnosticJson) throw transferError("DIAGNOSTIC_UNAVAILABLE", "No diagnostic is available for this import.", 404);
  assertExportIsSafe(history.diagnosticJson);
  return history.diagnosticJson;
}
