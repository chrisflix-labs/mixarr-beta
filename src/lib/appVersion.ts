import packageJson from "../../package.json";

function normalizeAppVersion(version: string) {
  const normalized = version.trim().replace(/^v/i, "");
  return normalized === "1.3.9-1" ? "1.3.9.1" : normalized;
}

export const APP_VERSION_NUMBER = normalizeAppVersion(process.env.NEXT_PUBLIC_APP_VERSION || packageJson.version);
export const APP_VERSION = `v${APP_VERSION_NUMBER}`;
