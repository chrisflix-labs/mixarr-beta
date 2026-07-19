import { createHash } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { z } from "zod";
import { APP_VERSION_NUMBER } from "../appVersion";
import { validateArtwork } from "../mixRecipes/archive";
import { canonicalize, scanSensitiveData } from "../mixRecipes/transfer";
import { mixRecipeDocumentSchema, type MixRecipeDocument } from "../mixRecipes/schema";
import { validateRecipe } from "../mixRecipes/validation";

export const COMMUNITY_RECIPE_FORMAT = "mixarr-community-recipe" as const;
export const COMMUNITY_FORMAT_VERSION = 1 as const;
export const SHARE_CODE_PREFIX = "MXR1:";
export const MAX_COMMUNITY_JSON_BYTES = 2 * 1024 * 1024;
export const MAX_COMMUNITY_ARCHIVE_BYTES = 20 * 1024 * 1024;
export const MAX_COMMUNITY_EXTRACTED_BYTES = 50 * 1024 * 1024;
export const MAX_COMMUNITY_FILES = 50;
export const MAX_SCREENSHOTS = 8;

const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const recipeId = /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/;
const safeUrl = z.string().trim().url().max(1000).refine((value) => new URL(value).protocol === "https:", "Only HTTPS URLs are allowed.");
const optionalUrl = safeUrl.optional().nullable();
const pathSchema = z.string().trim().min(1).max(240).refine(isSafeRelativePath, "Path must be a safe relative path.");

export const communityManifestSchema = z.object({
  format: z.literal(COMMUNITY_RECIPE_FORMAT),
  formatVersion: z.literal(COMMUNITY_FORMAT_VERSION),
  recipeId: z.string().trim().min(3).max(160).regex(recipeId),
  name: z.string().trim().min(1).max(120),
  version: z.string().trim().regex(semver, "Use a semantic version such as 1.0.0."),
  description: z.string().trim().max(2000).default(""),
  author: z.object({ name: z.string().trim().min(1).max(120), url: optionalUrl }).strict(),
  license: z.string().trim().min(1).max(80),
  minimumMixarrVersion: z.string().trim().regex(semver).optional().nullable(),
  homepage: optionalUrl,
  documentationUrl: optionalUrl,
  sourceUrl: optionalUrl,
  supportUrl: optionalUrl,
  tags: z.array(z.string()).max(20).default([]).transform(normalizeCommunityTags),
  artwork: pathSchema.optional().nullable(),
  screenshots: z.array(pathSchema).max(MAX_SCREENSHOTS).default([]),
  changelog: z.union([pathSchema, z.string().max(20_000)]).optional().nullable(),
  recipe: pathSchema.default("recipe.json"),
}).strict();

export type CommunityManifest = z.infer<typeof communityManifestSchema>;
export type ValidationSeverity = "info" | "warning" | "error";
export type CommunityValidationMessage = { severity: ValidationSeverity; code: string; message: string; field?: string; blocking: boolean; suggestion?: string };
export type CommunityTrustState = "official" | "known" | "unknown" | "modified" | "warning" | "blocked";
export type CommunityDocument = { manifest: CommunityManifest; recipe: MixRecipeDocument; changelog?: string | null; assets?: Record<string, string> };
export type CommunityPreview = {
  status: "valid" | "valid_with_warnings" | "incompatible" | "invalid" | "unsafe" | "unsupported_format";
  installable: boolean;
  manifest: CommunityManifest | null;
  recipe: MixRecipeDocument | null;
  messages: CommunityValidationMessage[];
  checksum: string | null;
  trustState: CommunityTrustState;
  installedMixarrVersion: string;
  sourceUrl?: string | null;
  sourceDisplay?: string | null;
  importMethod: "paste" | "code" | "upload" | "url" | "official";
  changelog?: string | null;
  assets?: Record<string, string>;
  conflict?: { recipeId: string; localId: string; name: string; version: string | null; locallyModified: boolean } | null;
  normalization: Array<{ field: string; message: string }>;
  ruleCount: number;
};

export function normalizeCommunityTags(tags: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const value = raw.normalize("NFKC").replace(/[<>\[\]{}*_`#]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
    const key = value.toLocaleLowerCase();
    if (value && !seen.has(key)) { seen.add(key); result.push(value); }
    if (result.length === 20) break;
  }
  return result;
}

export function compareVersions(left: string, right: string) {
  const parse = (value: string) => value.replace(/^v/i, "").split("-", 2)[0].split(".").map((part) => Number(part) || 0);
  const a = parse(left); const b = parse(right);
  for (let i = 0; i < 3; i += 1) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0);
  return 0;
}

export function isSafeRelativePath(value: string) {
  const path = value.replace(/\\/g, "/");
  return Boolean(path) && !path.includes("\0") && !path.startsWith("/") && !/^[A-Za-z]:\//.test(path) && !path.split("/").some((part) => part === ".." || part === "") && !path.includes("?") && !path.includes("#");
}

const ignoredPaths = new Set([".DS_Store", "Thumbs.db"]);
const documentation = new Set(["README.md", "CHANGELOG.md", "LICENSE", "LICENSE.md"]);
const prohibitedExtensions = new Set(["exe", "dll", "com", "bat", "cmd", "ps1", "sh", "js", "mjs", "cjs", "ts", "tsx", "py", "rb", "php", "jar", "msi", "scr", "so", "dylib", "sql", "dockerfile", "yml", "yaml", "toml", "lock"]);

export function validateCommunityArchivePath(name: string) {
  const path = name.replace(/\\/g, "/");
  const directory = path.endsWith("/"); const checkedPath = directory ? path.slice(0, -1) : path;
  if (!isSafeRelativePath(checkedPath)) throw communityError("ARCHIVE_TRAVERSAL", "The bundle contains an unsafe path.");
  if (directory) { if (["artwork", "screenshots", "__MACOSX"].includes(checkedPath)) return { path, ignored: true }; throw communityError("UNSUPPORTED_FILE", `Unsupported bundle directory: ${path.slice(0, 120)}`); }
  if (ignoredPaths.has(path) || path.endsWith("/.DS_Store") || path.endsWith("/Thumbs.db") || path.startsWith("__MACOSX/")) return { path, ignored: true };
  const lower = path.toLowerCase();
  const extension = lower.includes(".") ? lower.split(".").pop()! : lower;
  if (prohibitedExtensions.has(extension) || lower.endsWith("dockerfile") || lower.includes("docker-compose")) throw communityError("EXECUTABLE_CONTENT", "The bundle contains executable or installation content.");
  const allowed = path === "manifest.json" || path === "recipe.json" || documentation.has(path) || /^artwork\/[A-Za-z0-9._-]+\.(png|jpe?g|webp)$/i.test(path) || /^screenshots\/[A-Za-z0-9._-]+\.(png|jpe?g|webp)$/i.test(path);
  if (!allowed) throw communityError("UNSUPPORTED_FILE", `Unsupported bundle file: ${path.slice(0, 120)}`);
  return { path, ignored: false };
}

function inspectZipCentralDirectory(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength); const names = new Set<string>(); let count = 0; let extracted = 0;
  for (let offset = 0; offset + 46 <= data.length; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    count += 1;
    const flags = view.getUint16(offset + 8, true); const method = view.getUint16(offset + 10, true); const originalSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true); const extraLength = view.getUint16(offset + 30, true); const commentLength = view.getUint16(offset + 32, true);
    const madeBy = view.getUint16(offset + 4, true) >> 8; const mode = view.getUint32(offset + 38, true) >>> 16;
    const name = strFromU8(data.subarray(offset + 46, offset + 46 + nameLength));
    if ((flags & 1) !== 0) throw communityError("ENCRYPTED_ARCHIVE", "Encrypted bundle entries are not supported.");
    if (![0, 8].includes(method)) throw communityError("UNSUPPORTED_COMPRESSION", "The bundle uses an unsupported ZIP compression method.");
    if (madeBy === 3 && (mode & 0xf000) === 0xa000) throw communityError("ARCHIVE_SYMLINK", "Symbolic links are not allowed in bundles.");
    const normalized = name.replace(/\\/g, "/"); if (names.has(normalized)) throw communityError("DUPLICATE_ARCHIVE_PATH", "The bundle contains a duplicate file path."); names.add(normalized);
    extracted += originalSize; validateCommunityArchivePath(normalized);
    if (count > MAX_COMMUNITY_FILES || extracted > MAX_COMMUNITY_EXTRACTED_BYTES) throw communityError("ARCHIVE_LIMIT_EXCEEDED", "The bundle exceeds safe file-count or extracted-size limits.");
    offset += 45 + nameLength + extraLength + commentLength;
  }
  if (!count) throw communityError("INVALID_ARCHIVE", "The file is not a readable ZIP bundle.");
}

export function parseCommunityBundle(data: Uint8Array): CommunityDocument {
  if (data.length > MAX_COMMUNITY_ARCHIVE_BYTES) throw communityError("FILE_TOO_LARGE", "The bundle exceeds the 20 MB compressed-size limit.");
  inspectZipCentralDirectory(data);
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(data); } catch (error) { if ((error as any)?.code) throw error; throw communityError("INVALID_ARCHIVE", "The bundle could not be decompressed safely."); }
  const manifestBytes = files["manifest.json"]; if (!manifestBytes) throw communityError("MISSING_MANIFEST", "The bundle is missing manifest.json.");
  const manifest = parseManifest(decodeUtf8(manifestBytes, "manifest.json")); const recipeBytes = files[manifest.recipe];
  if (!recipeBytes) throw communityError("MISSING_RECIPE", `The bundle is missing ${manifest.recipe}.`);
  const recipe = parseRecipeJson(decodeUtf8(recipeBytes, manifest.recipe)); const assets: Record<string, string> = {};
  for (const path of [manifest.artwork, ...manifest.screenshots].filter(Boolean) as string[]) {
    const bytes = files[path]; if (!bytes) throw communityError("MISSING_ASSET", `The manifest references a missing asset: ${path}`);
    validateCommunityImage(bytes); assets[path] = Buffer.from(bytes).toString("base64");
  }
  let changelog: string | null = null;
  if (manifest.changelog) changelog = files[manifest.changelog] ? decodeUtf8(files[manifest.changelog], manifest.changelog).slice(0, 20_000) : manifest.changelog;
  return { manifest, recipe, changelog, assets };
}

export function parseManifest(input: string | unknown) {
  let value = input;
  if (typeof input === "string") { if (Buffer.byteLength(input) > MAX_COMMUNITY_JSON_BYTES) throw communityError("CONTENT_TOO_LARGE", "Community recipe JSON is too large."); try { value = JSON.parse(input); } catch { throw communityError("INVALID_JSON", "The community recipe is not valid JSON."); } }
  const result = communityManifestSchema.safeParse(value); if (!result.success) throw communityError("INVALID_MANIFEST", result.error.issues[0]?.message || "The manifest is invalid.", result.error.issues[0]?.path.join(".")); return result.data;
}

export function parseRecipeJson(input: string | unknown) {
  let value = input;
  if (typeof input === "string") { try { value = JSON.parse(input); } catch { throw communityError("INVALID_JSON", "recipe.json is not valid JSON."); } }
  const parsed = mixRecipeDocumentSchema.safeParse(value); if (!parsed.success) throw communityError("INVALID_RECIPE", parsed.error.issues[0]?.message || "The recipe data is invalid.", parsed.error.issues[0]?.path.join("."));
  const validation = validateRecipe(parsed.data); if (!validation.normalizedRecipe) throw communityError("INVALID_RECIPE", validation.errors[0]?.message || "The recipe rules are invalid."); return validation.normalizedRecipe;
}

export function parseCommunityJson(input: string | unknown): CommunityDocument {
  let value: any = input;
  if (typeof input === "string") { if (Buffer.byteLength(input) > MAX_COMMUNITY_JSON_BYTES) throw communityError("CONTENT_TOO_LARGE", "Pasted content exceeds the 2 MB limit."); try { value = JSON.parse(input); } catch { throw communityError("INVALID_JSON", "Pasted content is not valid JSON or a supported share code."); } }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw communityError("INVALID_DOCUMENT", "Community recipe data must be an object.");
  if (value.manifest && value.recipe) { const document = { manifest: parseManifest(value.manifest), recipe: parseRecipeJson(value.recipe), changelog: typeof value.changelog === "string" ? value.changelog.slice(0, 20_000) : null }; verifyDocumentIntegrity(document, value.integrity); return document; }
  if (value.format === COMMUNITY_RECIPE_FORMAT && value.recipe && typeof value.recipe === "object") {
    const { recipe, changelog, assets: _assets, integrity: _integrity, ...manifestInput } = value;
    const document = { manifest: parseManifest(manifestInput), recipe: parseRecipeJson(recipe), changelog: typeof changelog === "string" ? changelog.slice(0, 20_000) : null }; verifyDocumentIntegrity(document, value.integrity); return document;
  }
  throw communityError("UNSUPPORTED_FORMAT", "Expected a Mixarr community recipe document or MXR1 share code.");
}

export function checksumCommunityDocument(document: CommunityDocument) {
  return createHash("sha256").update(canonicalize({ manifest: document.manifest, recipe: document.recipe, changelog: document.changelog || null })).digest("hex");
}

export function encodeShareCode(document: CommunityDocument) {
  const portable = { manifest: { ...document.manifest, artwork: null, screenshots: [] }, recipe: document.recipe, changelog: document.changelog || null };
  const json = canonicalize(portable); if (Buffer.byteLength(json) > MAX_COMMUNITY_JSON_BYTES) throw communityError("CONTENT_TOO_LARGE", "This recipe is too large for a share code.");
  const payload = deflateRawSync(Buffer.from(json)).toString("base64url"); const checksum = createHash("sha256").update(json).digest("hex").slice(0, 24); return `${SHARE_CODE_PREFIX}${payload}.${checksum}`;
}

export function decodeShareCode(code: string) {
  const clean = code.trim(); if (!clean.startsWith(SHARE_CODE_PREFIX)) throw communityError("INVALID_SHARE_CODE", "Share codes must begin with MXR1:.");
  const [payload, provided] = clean.slice(SHARE_CODE_PREFIX.length).split("."); if (!payload || !provided || !/^[a-f0-9]{24}$/.test(provided)) throw communityError("INVALID_SHARE_CODE", "This share code is incomplete or corrupted.");
  let json: string; try { const compressed = Buffer.from(payload, "base64url"); if (compressed.length > MAX_COMMUNITY_JSON_BYTES) throw new Error(); const inflated = inflateRawSync(compressed, { maxOutputLength: MAX_COMMUNITY_JSON_BYTES }); json = inflated.toString("utf8"); } catch { throw communityError("INVALID_SHARE_CODE", "This share code could not be decoded safely."); }
  const actual = createHash("sha256").update(json).digest("hex").slice(0, 24); if (actual !== provided) throw communityError("SHARE_CODE_CHECKSUM", "The share code checksum does not match. Copy the code again."); return parseCommunityJson(json);
}

export function buildCommunityJson(document: CommunityDocument) {
  const normalized = { ...document, manifest: parseManifest(document.manifest) }; const checksum = checksumCommunityDocument(normalized); return JSON.stringify({ manifest: normalized.manifest, recipe: normalized.recipe, changelog: normalized.changelog || undefined, integrity: { algorithm: "sha256", checksum } }, null, 2);
}

export function buildCommunityBundle(document: CommunityDocument, binaryAssets: Record<string, Uint8Array> = {}) {
  const manifest = { ...document.manifest, recipe: "recipe.json" }; const files: Record<string, Uint8Array> = { "manifest.json": strToU8(JSON.stringify(manifest, null, 2)), "recipe.json": strToU8(JSON.stringify(document.recipe, null, 2)) };
  if (document.changelog) { files["CHANGELOG.md"] = strToU8(document.changelog); manifest.changelog = "CHANGELOG.md"; files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2)); }
  for (const [path, bytes] of Object.entries(binaryAssets)) { validateCommunityArchivePath(path); validateCommunityImage(bytes); files[path] = bytes; }
  const output = zipSync(files, { level: 6 }); if (output.length > MAX_COMMUNITY_ARCHIVE_BYTES) throw communityError("FILE_TOO_LARGE", "The exported bundle exceeds the 20 MB limit."); return output;
}

export function validateCommunityDocument(document: CommunityDocument, options: { sourceUrl?: string | null; importMethod: CommunityPreview["importMethod"]; official?: boolean; known?: boolean }): CommunityPreview {
  const messages: CommunityValidationMessage[] = []; const normalization: CommunityPreview["normalization"] = [];
  const scan = scanSensitiveData({ manifest: document.manifest, recipe: document.recipe, changelog: document.changelog });
  for (const finding of scan.findings) messages.push({ severity: "error", code: "PROHIBITED_SECRET", message: "A credential, private address, environment value, or installation-specific identifier was detected.", field: finding.path, blocking: true, suggestion: "Remove the prohibited value; community recipes must contain portable data only." });
  const serialized = canonicalize(document);
  if (/(?:pre|post)[-_ ]?install|runCommand|customScript|<script|javascript:|onerror\s*=|\$\{(?:process|env)\.|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY/i.test(serialized)) messages.push({ severity: "error", code: "EXECUTABLE_CONTENT", message: "Script-like, hook, template, or executable content is not allowed.", blocking: true });
  if (document.manifest.minimumMixarrVersion && compareVersions(APP_VERSION_NUMBER, document.manifest.minimumMixarrVersion) < 0) messages.push({ severity: "error", code: "MIXARR_VERSION_INCOMPATIBLE", message: `This recipe requires Mixarr ${document.manifest.minimumMixarrVersion}; installed version is ${APP_VERSION_NUMBER}.`, field: "minimumMixarrVersion", blocking: true, suggestion: "Upgrade Mixarr before importing this recipe." });
  if (!document.manifest.minimumMixarrVersion) messages.push({ severity: "warning", code: "MINIMUM_VERSION_MISSING", message: "The author did not declare a minimum Mixarr version.", field: "minimumMixarrVersion", blocking: false });
  if (!options.official) messages.push({ severity: "warning", code: "THIRD_PARTY_SOURCE", message: "Community recipes are third-party data. Review every rule before importing.", blocking: false });
  for (const [assetPath, base64] of Object.entries(document.assets || {})) { try { validateCommunityImage(new Uint8Array(Buffer.from(base64, "base64"))); } catch { messages.push({ severity: "error", code: "INVALID_IMAGE", message: "An artwork or screenshot file is invalid, animated, unsupported, or too large.", field: assetPath, blocking: true }); } }
  const normalizedTags = normalizeCommunityTags(document.manifest.tags); if (canonicalize(normalizedTags) !== canonicalize(document.manifest.tags)) normalization.push({ field: "tags", message: "Tags were trimmed, deduplicated, and stripped of markup." });
  const blocking = messages.some((item) => item.blocking); const incompatible = messages.some((item) => item.code === "MIXARR_VERSION_INCOMPATIBLE");
  const substantiveWarning = messages.some((item) => item.severity === "warning" && item.code !== "THIRD_PARTY_SOURCE");
  return { status: blocking ? (scan.safe ? incompatible ? "incompatible" : "invalid" : "unsafe") : messages.some((item) => item.severity === "warning") ? "valid_with_warnings" : "valid", installable: !blocking, manifest: { ...document.manifest, tags: normalizedTags }, recipe: document.recipe, messages, checksum: checksumCommunityDocument(document), trustState: blocking ? "blocked" : options.official ? "official" : options.known ? "known" : substantiveWarning ? "warning" : "unknown", installedMixarrVersion: APP_VERSION_NUMBER, sourceUrl: options.sourceUrl || null, sourceDisplay: options.sourceUrl ? safeDisplayUrl(options.sourceUrl) : null, importMethod: options.importMethod, changelog: document.changelog || null, assets: document.assets, conflict: null, normalization, ruleCount: Array.isArray((document.recipe.generation as any).rules) ? (document.recipe.generation as any).rules.length : 0 };
}

export function safeDisplayUrl(value: string) { const url = new URL(value); url.username = ""; url.password = ""; url.search = ""; url.hash = ""; return url.toString(); }
export function communityError(code: string, message: string, field?: string, status = 400) { return Object.assign(new Error(message), { code, field, status }); }

function decodeUtf8(bytes: Uint8Array, filename: string) { try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw communityError("INVALID_UTF8", `${filename} must contain valid UTF-8 text.`); } }
function verifyDocumentIntegrity(document: CommunityDocument, integrity: unknown) { if (integrity == null) return; if (!integrity || typeof integrity !== "object" || (integrity as any).algorithm !== "sha256" || !/^[a-f0-9]{64}$/.test((integrity as any).checksum || "")) throw communityError("INVALID_CHECKSUM", "The community recipe integrity field is invalid."); if ((integrity as any).checksum !== checksumCommunityDocument(document)) throw communityError("CHECKSUM_MISMATCH", "The community recipe checksum does not match its content."); }
export function validateCommunityImage(data: Uint8Array) { const ascii = Buffer.from(data).toString("latin1"); if (ascii.includes("acTL") || (ascii.startsWith("RIFF") && ascii.includes("WEBP") && data[12] === 0x56 && data[13] === 0x50 && data[14] === 0x38 && data[15] === 0x58 && (data[20] & 0x02) !== 0)) throw communityError("ANIMATED_IMAGE", "Animated recipe images are not supported."); return validateArtwork(data); }
