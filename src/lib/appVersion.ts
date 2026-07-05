import packageJson from "../../package.json";

function normalizeAppVersion(version: string) {
  return version.trim().replace(/^v/i, "");
}

export const APP_VERSION_NUMBER = normalizeAppVersion(process.env.NEXT_PUBLIC_APP_VERSION || packageJson.version);
export const APP_VERSION = `v${APP_VERSION_NUMBER}`;
