/**
 * Minimal, self-contained ZIP container for Library Intelligence backups.
 *
 * Built on Node's `zlib` (raw deflate) so it has no third-party dependency. The
 * reader parses the central directory and enforces strict security limits BEFORE
 * decompressing anything, defending against path traversal, symlinks, absolute
 * paths, zip bombs, oversize/oversized-entry archives, and unexpected entries.
 */
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { BackupValidationError, LIMITS, ARCHIVE_ENTRY } from "./archiveFormat";

const LOCAL_FILE_SIG = 0x04034b50;
const CENTRAL_DIR_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

// Precomputed CRC-32 table.
const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export type ZipEntryInput = { name: string; data: Buffer; store?: boolean };

/** Build a ZIP archive buffer from in-memory entries. */
export function buildZip(entries: ZipEntryInput[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const useStore = entry.store === true;
    const compressed = useStore ? entry.data : deflateRawSync(entry.data, { level: 6 });
    const method = useStore ? 0 : 8;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_FILE_SIG, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0x21, 12); // mod date (1980-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    localParts.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_DIR_SIG, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12); // mod time
    central.writeUInt16LE(0x21, 14); // mod date
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs (regular file)
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const localData = Buffer.concat(localParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4); // disk
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(localData.length, 16);
  eocd.writeUInt16LE(0, 20); // comment length
  return Buffer.concat([localData, centralDir, eocd]);
}

export type ZipDirectoryEntry = {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  crc: number;
  localHeaderOffset: number;
  externalAttrs: number;
};

const S_IFLNK = 0xa000; // unix symlink type bits

function isSymlink(externalAttrs: number): boolean {
  const unixMode = (externalAttrs >>> 16) & 0xffff;
  return (unixMode & 0xf000) === S_IFLNK;
}

function isUnsafeEntryName(name: string): boolean {
  if (!name) return true;
  if (name.includes("\0")) return true;
  if (name.startsWith("/") || name.startsWith("\\")) return true;
  if (/^[a-zA-Z]:/.test(name)) return true; // drive-letter absolute
  const parts = name.split(/[/\\]/);
  return parts.some((p) => p === "..");
}

/** Parse and validate the central directory without decompressing entry data. */
export function readZipDirectory(archive: Buffer): ZipDirectoryEntry[] {
  if (archive.length > LIMITS.maxArchiveBytes) {
    throw new BackupValidationError("Backup archive exceeds the maximum allowed size.");
  }
  if (archive.length < 22) throw new BackupValidationError("File is too small to be a valid backup archive.");

  // Locate EOCD by scanning backwards (comment is always empty here, but be tolerant).
  let eocdOffset = -1;
  const minScan = Math.max(0, archive.length - 22 - 0xffff);
  for (let i = archive.length - 22; i >= minScan; i--) {
    if (archive.readUInt32LE(i) === EOCD_SIG) { eocdOffset = i; break; }
  }
  if (eocdOffset < 0) throw new BackupValidationError("Backup archive is missing its ZIP directory (not a valid archive).");

  const totalEntries = archive.readUInt16LE(eocdOffset + 10);
  const centralDirSize = archive.readUInt32LE(eocdOffset + 12);
  const centralDirOffset = archive.readUInt32LE(eocdOffset + 16);
  if (totalEntries > LIMITS.maxArchiveEntries) {
    throw new BackupValidationError("Backup archive contains an unexpected number of entries.");
  }
  if (centralDirOffset + centralDirSize > archive.length) {
    throw new BackupValidationError("Backup archive directory is corrupt.");
  }

  const entries: ZipDirectoryEntry[] = [];
  let ptr = centralDirOffset;
  let totalUncompressed = 0;
  for (let i = 0; i < totalEntries; i++) {
    if (ptr + 46 > archive.length || archive.readUInt32LE(ptr) !== CENTRAL_DIR_SIG) {
      throw new BackupValidationError("Backup archive directory is corrupt.");
    }
    const method = archive.readUInt16LE(ptr + 10);
    const crc = archive.readUInt32LE(ptr + 16);
    const compressedSize = archive.readUInt32LE(ptr + 20);
    const uncompressedSize = archive.readUInt32LE(ptr + 24);
    const nameLen = archive.readUInt16LE(ptr + 28);
    const extraLen = archive.readUInt16LE(ptr + 30);
    const commentLen = archive.readUInt16LE(ptr + 32);
    const externalAttrs = archive.readUInt32LE(ptr + 38);
    const localHeaderOffset = archive.readUInt32LE(ptr + 42);
    const name = archive.toString("utf8", ptr + 46, ptr + 46 + nameLen);

    if (method !== 0 && method !== 8) throw new BackupValidationError("Backup archive uses an unsupported compression method.");
    if (isSymlink(externalAttrs)) throw new BackupValidationError("Backup archive contains a symlink entry, which is not allowed.");
    if (isUnsafeEntryName(name)) throw new BackupValidationError("Backup archive contains an unsafe entry path.");
    if (uncompressedSize > LIMITS.maxUncompressedBytes) throw new BackupValidationError("A backup archive entry is too large.");
    if (compressedSize > 0 && uncompressedSize / compressedSize > LIMITS.maxCompressionRatio) {
      throw new BackupValidationError("Backup archive has an implausible compression ratio (possible zip bomb).");
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > LIMITS.maxUncompressedBytes) {
      throw new BackupValidationError("Backup archive decompresses to an unsafe size (possible zip bomb).");
    }

    entries.push({ name, method, compressedSize, uncompressedSize, crc, localHeaderOffset, externalAttrs });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Decompress a single validated entry, verifying CRC and declared size. */
export function readZipEntry(archive: Buffer, entry: ZipDirectoryEntry): Buffer {
  const lho = entry.localHeaderOffset;
  if (lho + 30 > archive.length || archive.readUInt32LE(lho) !== LOCAL_FILE_SIG) {
    throw new BackupValidationError("Backup archive local header is corrupt.");
  }
  const nameLen = archive.readUInt16LE(lho + 26);
  const extraLen = archive.readUInt16LE(lho + 28);
  const dataStart = lho + 30 + nameLen + extraLen;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > archive.length) throw new BackupValidationError("Backup archive entry data is out of bounds.");
  const raw = archive.subarray(dataStart, dataEnd);

  let out: Buffer;
  if (entry.method === 0) {
    out = Buffer.from(raw);
  } else {
    try {
      out = inflateRawSync(raw);
    } catch {
      throw new BackupValidationError("Backup archive entry could not be decompressed (corrupt or tampered).");
    }
  }
  if (out.length !== entry.uncompressedSize) {
    throw new BackupValidationError("Backup archive entry size mismatch after decompression.");
  }
  if (out.length > LIMITS.maxUncompressedBytes) {
    throw new BackupValidationError("Backup archive entry exceeded the safe decompressed size.");
  }
  if (crc32(out) !== entry.crc) {
    throw new BackupValidationError("Backup archive entry failed its CRC check (corrupt or tampered).");
  }
  return out;
}

/** Read a named entry as a UTF-8 string, or null if absent. */
export function readNamedEntry(archive: Buffer, entries: ZipDirectoryEntry[], name: string): Buffer | null {
  const entry = entries.find((e) => e.name === name);
  return entry ? readZipEntry(archive, entry) : null;
}

export const KNOWN_ARCHIVE_ENTRY_NAMES = new Set<string>([
  ARCHIVE_ENTRY.manifest,
  ARCHIVE_ENTRY.tracks,
  ARCHIVE_ENTRY.checksums,
]);
