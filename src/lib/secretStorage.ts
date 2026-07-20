import crypto from "crypto";

const ENCRYPTION_VERSION = "v1";
const ALGORITHM = "aes-256-gcm";

function configuredSecretKey(scope: "default" | "ai" = "default") {
  if (scope === "ai") return process.env.AI_CREDENTIAL_ENCRYPTION_KEY || process.env.MIXARR_SECRET_KEY || "";
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

function getAiEncryptionKey() {
  const raw = configuredSecretKey("ai").trim();
  if (!raw) throw new Error("AI credential encryption is not configured. Secret-based AI providers cannot be saved or used.");
  return crypto.createHash("sha256").update(raw).digest();
}

export function isAiSecretEncryptionConfigured() {
  return configuredSecretKey("ai").trim().length > 0;
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

export function encryptAiSecret(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getAiEncryptionKey(), iv);
  cipher.setAAD(Buffer.from("mixarr:ai-provider-credential:v1"));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [ENCRYPTION_VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(":");
}

export function decryptAiSecret(value: string) {
  const [version, ivRaw, tagRaw, encryptedRaw] = value.split(":");
  if (version !== ENCRYPTION_VERSION || !ivRaw || !tagRaw || !encryptedRaw) throw new Error("Unsupported encrypted AI secret format.");
  const decipher = crypto.createDecipheriv(ALGORITHM, getAiEncryptionKey(), Buffer.from(ivRaw, "base64url"));
  decipher.setAAD(Buffer.from("mixarr:ai-provider-credential:v1"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedRaw, "base64url")), decipher.final()]).toString("utf8");
}

export function maskSecret(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length <= 4) return "Saved credential";
  return `${"•".repeat(12)}${trimmed.slice(-4)}`;
}
