export const APP_NAME = "Mixarr";
export const APP_DESCRIPTION = "Smart Playlist Engine";
export const DEFAULT_GITHUB_REPO_URL = "https://github.com/cvarano84/mixarr-beta";

export function validHttpUrl(value: string | undefined | null) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export const MIXARR_GITHUB_URL = validHttpUrl(process.env.NEXT_PUBLIC_GITHUB_REPO_URL) || DEFAULT_GITHUB_REPO_URL;
