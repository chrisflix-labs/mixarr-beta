import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { communityError, MAX_COMMUNITY_ARCHIVE_BYTES, MAX_COMMUNITY_JSON_BYTES, safeDisplayUrl } from "./core";

const MAX_REDIRECTS = 4;
const DOWNLOAD_TIMEOUT_MS = 12_000;

export function normalizeCommunitySourceUrl(input: string) {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw communityError("INVALID_URL", "Enter a valid HTTPS URL.", "url"); }
  if (url.protocol !== "https:") throw communityError("UNSUPPORTED_PROTOCOL", "Community recipe URLs must use HTTPS.", "url");
  if (url.username || url.password) throw communityError("URL_CREDENTIALS", "URLs containing embedded credentials are not allowed.", "url");
  const host = url.hostname.toLowerCase();
  if (host === "github.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 5 && parts[2] === "blob") url = new URL(`https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/${parts[3]}/${parts.slice(4).join("/")}`);
  }
  url.hash = "";
  return url;
}

function blockedIpv4(ip: string) {
  const parts = ip.split(".").map(Number); if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
}

function blockedIpv6(ip: string) {
  const value = ip.toLowerCase().split("%")[0]; return value === "::" || value === "::1" || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb") || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("ff") || value.startsWith("::ffff:127.") || value.startsWith("::ffff:10.") || value.startsWith("::ffff:192.168.");
}

export function isPublicAddress(address: string) { const type = isIP(address); return type === 4 ? !blockedIpv4(address) : type === 6 ? !blockedIpv6(address) : false; }

export async function assertPublicCommunityUrl(input: string | URL) {
  const url = input instanceof URL ? input : normalizeCommunitySourceUrl(input); const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "metadata.google.internal" || host === "metadata.azure.internal") throw communityError("PRIVATE_ADDRESS", "Local, private, and metadata service addresses are not allowed.", "url");
  if (isIP(host)) { if (!isPublicAddress(host)) throw communityError("PRIVATE_ADDRESS", "Local, private, and metadata service addresses are not allowed.", "url"); return url; }
  let addresses: Array<{ address: string; family: number }>;
  try { addresses = await lookup(host, { all: true, verbatim: true }); } catch { throw communityError("URL_UNAVAILABLE", "The recipe host could not be resolved.", "url", 422); }
  if (!addresses.length || addresses.some((entry) => !isPublicAddress(entry.address))) throw communityError("PRIVATE_ADDRESS", "The recipe URL resolves to a local or private address.", "url"); return url;
}

export type CommunityDownload = { data: Uint8Array; contentType: string; finalUrl: string; displayUrl: string; kind: "json" | "zip" };

export async function fetchCommunityRecipe(input: string): Promise<CommunityDownload> {
  let url = normalizeCommunitySourceUrl(input);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    await assertPublicCommunityUrl(url);
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    let response: Response;
    try { response = await fetch(url, { redirect: "manual", signal: controller.signal, headers: { Accept: "application/json, application/zip, application/octet-stream", "User-Agent": "Mixarr-Community-Recipe/2.3.5" }, cache: "no-store" }); }
    catch { clearTimeout(timeout); throw communityError("DOWNLOAD_FAILED", "The recipe could not be downloaded securely.", "url", 422); }
    clearTimeout(timeout);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location"); if (!location || redirect === MAX_REDIRECTS) throw communityError("REDIRECT_LIMIT", "The recipe URL redirected too many times.", "url", 422);
      url = normalizeCommunitySourceUrl(new URL(location, url).toString()); continue;
    }
    if (!response.ok) throw communityError("DOWNLOAD_FAILED", `The recipe host returned HTTP ${response.status}.`, "url", 422);
    const declaredLength = Number(response.headers.get("content-length") || 0); if (declaredLength > MAX_COMMUNITY_ARCHIVE_BYTES) throw communityError("DOWNLOAD_TOO_LARGE", "The remote recipe exceeds the download limit.", "url", 413);
    const chunks: Uint8Array[] = []; let total = 0; const reader = response.body?.getReader(); if (!reader) throw communityError("DOWNLOAD_FAILED", "The recipe host returned no readable response.", "url", 422);
    while (true) { const part = await reader.read(); if (part.done) break; total += part.value.length; if (total > MAX_COMMUNITY_ARCHIVE_BYTES) { await reader.cancel(); throw communityError("DOWNLOAD_TOO_LARGE", "The remote recipe exceeds the download limit.", "url", 413); } chunks.push(part.value); }
    const data = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
    const contentType = (response.headers.get("content-type") || "").split(";", 1)[0].toLowerCase(); const zip = data[0] === 0x50 && data[1] === 0x4b; const json = data.length <= MAX_COMMUNITY_JSON_BYTES && /^[\s\uFEFF]*(?:\{|MXR1:)/.test(Buffer.from(data.subarray(0, Math.min(data.length, 32))).toString("utf8"));
    if (!zip && !json) throw communityError("UNSUPPORTED_CONTENT", "The URL did not return JSON, a share code, or a ZIP recipe bundle.", "url", 415);
    if (zip && contentType.includes("html") || json && contentType.includes("html")) throw communityError("UNSUPPORTED_CONTENT", "HTML pages are not imported. Use a direct recipe file link.", "url", 415);
    return { data, contentType, finalUrl: url.toString(), displayUrl: safeDisplayUrl(url.toString()), kind: zip ? "zip" : "json" };
  }
  throw communityError("REDIRECT_LIMIT", "The recipe URL redirected too many times.", "url", 422);
}
