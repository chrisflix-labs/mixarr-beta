import crypto from "crypto";

const ENCRYPTION_VERSION = "v1";
const ALGORITHM = "aes-256-gcm";

function configuredSecretKey() {
  return process.env.MIXARR_SECRET_KEY || "";
}

export function isSecretEncryptionConfigured() {
  return configuredSecretKey().trim().length > 0;
}

function getEncryptionKey() {
  const raw = configuredSecretKey().trim();
  if (!raw) {
    throw new Error("Secret encryption key is not configured. API credentials cannot be saved from the UI.");
  }
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptSecret(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    ENCRYPTION_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

export function decryptSecret(value: string) {
  const [version, ivRaw, tagRaw, encryptedRaw] = value.split(":");
  if (version !== ENCRYPTION_VERSION || !ivRaw || !tagRaw || !encryptedRaw) {
    throw new Error("Unsupported encrypted secret format.");
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function maskSecret(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length <= 4) return "Saved credential";
  return `${"•".repeat(12)}${trimmed.slice(-4)}`;
}
