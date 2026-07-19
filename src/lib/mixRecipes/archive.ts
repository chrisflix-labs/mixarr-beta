import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { MAX_RECIPE_ARCHIVE_BYTES, sha256, type PortableArtwork, type RecipeBundleEnvelope, type RecipeExportEnvelope } from "./transfer";

export const MAX_ARCHIVE_FILES = 220;
export const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
export const MAX_ARTWORK_BYTES = 3 * 1024 * 1024;
export const MAX_ARTWORK_DIMENSION = 4096;

export type ValidArtwork = { data: Uint8Array; mimeType: "image/png" | "image/jpeg" | "image/webp"; extension: "png" | "jpg" | "webp"; width: number; height: number; checksum: string };

const executableExtensions = new Set(["exe", "dll", "com", "bat", "cmd", "ps1", "sh", "js", "mjs", "cjs", "jar", "msi", "scr", "app", "dmg", "so"]);
const archiveExtensions = new Set(["zip", "rar", "7z", "tar", "gz", "bz2", "xz"]);

function archiveError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

export function validateArchivePath(name: string) {
  const normalized = name.replace(/\\/g, "/");
  if (!normalized || normalized.includes("\0") || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.split("/").includes("..")) {
    throw archiveError("ARCHIVE_TRAVERSAL_ATTEMPT", "The archive contains an unsafe file path.");
  }
  const extension = normalized.split(".").pop()?.toLowerCase() || "";
  if (executableExtensions.has(extension)) throw archiveError("ARCHIVE_EXECUTABLE_FILE", "The archive contains an unsupported executable file.");
  if (archiveExtensions.has(extension)) throw archiveError("ARCHIVE_NESTED_ARCHIVE", "Nested archives are not supported.");
  if (!(normalized === "manifest.json" || normalized.startsWith("recipes/") || normalized.startsWith("artwork/"))) {
    throw archiveError("ARCHIVE_UNEXPECTED_FILE", `The archive contains an unexpected file: ${normalized.slice(0, 120)}`);
  }
  return normalized;
}

// ZIP symlinks are identified by the Unix file type bits in the central directory.
function rejectZipSymlinks(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let offset = 0; offset + 46 <= data.length; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const madeBy = view.getUint16(offset + 4, true) >> 8;
    const externalAttributes = view.getUint32(offset + 38, true);
    const unixMode = externalAttributes >>> 16;
    if (madeBy === 3 && (unixMode & 0xf000) === 0xa000) throw archiveError("ARCHIVE_SYMLINK", "Symbolic links are not allowed in recipe archives.");
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    offset += 45 + nameLength + extraLength + commentLength;
  }
}

function pngDimensions(data: Uint8Array) {
  if (data.length < 24 || data[0] !== 0x89 || data[1] !== 0x50 || data[2] !== 0x4e || data[3] !== 0x47) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20), mimeType: "image/png" as const, extension: "png" as const };
}

function jpegDimensions(data: Uint8Array) {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) { offset += 1; continue; }
    const marker = data[offset + 1];
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { width: (data[offset + 7] << 8) | data[offset + 8], height: (data[offset + 5] << 8) | data[offset + 6], mimeType: "image/jpeg" as const, extension: "jpg" as const };
    }
    const length = (data[offset + 2] << 8) | data[offset + 3];
    if (length < 2) break;
    offset += 2 + length;
  }
  return null;
}

function webpDimensions(data: Uint8Array) {
  if (data.length < 30 || strFromU8(data.subarray(0, 4)) !== "RIFF" || strFromU8(data.subarray(8, 12)) !== "WEBP") return null;
  const type = strFromU8(data.subarray(12, 16));
  if (type === "VP8X") return { width: 1 + data[24] + (data[25] << 8) + (data[26] << 16), height: 1 + data[27] + (data[28] << 8) + (data[29] << 16), mimeType: "image/webp" as const, extension: "webp" as const };
  if (type === "VP8 " && data.length >= 30) return { width: (data[26] | (data[27] << 8)) & 0x3fff, height: (data[28] | (data[29] << 8)) & 0x3fff, mimeType: "image/webp" as const, extension: "webp" as const };
  if (type === "VP8L" && data.length >= 25) {
    const bits = data[21] | (data[22] << 8) | (data[23] << 16) | (data[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, mimeType: "image/webp" as const, extension: "webp" as const };
  }
  return null;
}

export function validateArtwork(data: Uint8Array): ValidArtwork {
  if (data.length === 0 || data.length > MAX_ARTWORK_BYTES) throw archiveError("ARTWORK_INVALID", `Artwork must be no larger than ${MAX_ARTWORK_BYTES / 1024 / 1024} MB.`);
  const dimensions = pngDimensions(data) || jpegDimensions(data) || webpDimensions(data);
  if (!dimensions) throw archiveError("ARTWORK_INVALID", "Artwork must be a valid PNG, JPEG, or WebP image.");
  if (dimensions.width < 1 || dimensions.height < 1 || dimensions.width > MAX_ARTWORK_DIMENSION || dimensions.height > MAX_ARTWORK_DIMENSION) {
    throw archiveError("ARTWORK_INVALID", `Artwork dimensions must not exceed ${MAX_ARTWORK_DIMENSION}×${MAX_ARTWORK_DIMENSION}.`);
  }
  return { data, ...dimensions, checksum: sha256(data) };
}

export function parseRecipeArchive(data: Uint8Array) {
  if (data.length > MAX_RECIPE_ARCHIVE_BYTES) throw archiveError("FILE_TOO_LARGE", "Recipe archive is too large.");
  rejectZipSymlinks(data);
  let fileCount = 0;
  let uncompressedBytes = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, {
      filter(file) {
        fileCount += 1;
        uncompressedBytes += file.originalSize;
        validateArchivePath(file.name);
        if (fileCount > MAX_ARCHIVE_FILES || uncompressedBytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES) throw archiveError("ARCHIVE_LIMIT_EXCEEDED", "Recipe archive exceeds the file-count or uncompressed-size limit.");
        return true;
      },
    });
  } catch (error) {
    if ((error as Error & { code?: string }).code) throw error;
    throw archiveError("INVALID_ARCHIVE", "The recipe archive could not be read safely.");
  }
  const manifest = files["manifest.json"];
  if (!manifest) throw archiveError("MISSING_MANIFEST", "Recipe archive is missing manifest.json.");
  if (manifest.length > 5 * 1024 * 1024) throw archiveError("FILE_TOO_LARGE", "Recipe archive manifest is too large.");
  const artwork = new Map<string, ValidArtwork>();
  for (const [name, value] of Object.entries(files)) {
    if (name.startsWith("artwork/") && !name.endsWith("/")) artwork.set(name, validateArtwork(value));
  }
  return { manifestText: strFromU8(manifest), artwork, fileCount, uncompressedBytes };
}

export function artworkDescriptor(reference: string, artwork: ValidArtwork): PortableArtwork {
  return { included: true, reference, mimeType: artwork.mimeType, checksum: artwork.checksum };
}

export function buildRecipeArchive(manifest: RecipeExportEnvelope | RecipeBundleEnvelope, artwork: Map<string, ValidArtwork>) {
  const files: Record<string, Uint8Array> = { "manifest.json": strToU8(JSON.stringify(manifest, null, 2)) };
  for (const [name, asset] of Array.from(artwork.entries())) {
    const safeName = validateArchivePath(name);
    if (!safeName.startsWith("artwork/")) throw archiveError("ARCHIVE_UNEXPECTED_FILE", "Artwork must be stored in the artwork directory.");
    files[safeName] = asset.data;
  }
  return zipSync(files, { level: 6 });
}
