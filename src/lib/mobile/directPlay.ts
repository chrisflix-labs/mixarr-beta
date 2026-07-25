/**
 * Direct Play decision logic for the mobile app. A track is Direct-Playable
 * only when its audio codec/container is one that AVFoundation on iOS 17 can
 * play from the original file with no server-side transcoding. We deliberately
 * decide from server/Plex media metadata (codec + container), never from a
 * filename extension alone.
 */

// Codecs AVFoundation plays natively on iOS 17.
const DIRECT_PLAY_CODECS = new Set([
  "aac", "alac", "mp3", "mp2", "flac",
  "pcm", "lpcm", "pcm_s16le", "pcm_s24le", "pcm_s16be", "pcm_s24be",
]);

// Containers those codecs are expected to arrive in.
const DIRECT_PLAY_CONTAINERS = new Set([
  "mp3", "aac", "adts", "m4a", "mp4", "m4b", "alac",
  "flac", "wav", "wave", "aiff", "aif", "aifc",
]);

export interface PlexPartInfo {
  partKey: string | null;
  container: string | null;
  codec: string | null;
  bitrate: number | null;
  sampleRate: number | null;
  bitDepth: number | null;
  channels: number | null;
  mimeType: string | null;
}

export interface DirectPlayDecision {
  canDirectPlay: boolean;
  reason: string | null;
}

const CONTAINER_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  aac: "audio/aac",
  adts: "audio/aac",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  m4b: "audio/mp4",
  alac: "audio/mp4",
  flac: "audio/flac",
  wav: "audio/wav",
  wave: "audio/wav",
  aiff: "audio/aiff",
  aif: "audio/aiff",
  aifc: "audio/aiff",
};

function normalize(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toLowerCase();
  return text.length ? text : null;
}

/** Best-effort decision from only a stored file-format string (browse lists). */
export function decideFromFormat(fileFormat: string | null | undefined): DirectPlayDecision {
  const format = normalize(fileFormat);
  if (!format) return { canDirectPlay: false, reason: "Audio format is unknown." };
  if (DIRECT_PLAY_CONTAINERS.has(format) || DIRECT_PLAY_CODECS.has(format)) {
    return { canDirectPlay: true, reason: null };
  }
  return { canDirectPlay: false, reason: `The ${format.toUpperCase()} format cannot be played directly.` };
}

/** Authoritative decision from live Plex Media/Part metadata. */
export function decideFromPart(part: PlexPartInfo): DirectPlayDecision {
  const codec = normalize(part.codec);
  const container = normalize(part.container);
  const codecOk = codec ? DIRECT_PLAY_CODECS.has(codec) : false;
  const containerOk = container ? DIRECT_PLAY_CONTAINERS.has(container) : false;

  if (codecOk || containerOk) return { canDirectPlay: true, reason: null };

  const label = (codec || container || "unknown").toUpperCase();
  return { canDirectPlay: false, reason: `The ${label} format cannot be played directly.` };
}

export function mimeForContainer(container: string | null, codec: string | null): string | null {
  const key = normalize(container) || normalize(codec);
  if (!key) return null;
  return CONTAINER_MIME[key] || null;
}

/**
 * Reads a single track's playable Part metadata from Plex. Returns codec,
 * container, and quality details needed for the Direct Play decision and the
 * Now Playing technical readout. The Plex token never leaves the server.
 */
export async function fetchPlexPartInfo(serverUri: string, ratingKey: string, accessToken: string): Promise<PlexPartInfo | null> {
  const base = serverUri.endsWith("/") ? serverUri : `${serverUri}/`;
  const response = await fetch(new URL(`library/metadata/${encodeURIComponent(ratingKey)}`, base), {
    headers: {
      Accept: "application/json",
      "X-Plex-Token": accessToken,
      "X-Plex-Client-Identifier": (process.env.PLEX_CLIENT_IDENTIFIER || "mixarr").trim(),
    },
    cache: "no-store",
  });
  if (!response.ok) return null;

  const data = await response.json().catch(() => null);
  const metadata = data?.MediaContainer?.Metadata?.[0];
  const media = Array.isArray(metadata?.Media) ? metadata.Media[0] : null;
  const part = Array.isArray(media?.Part) ? media.Part[0] : null;
  if (!part) return null;

  const container = normalize(part.container) || normalize(media?.container);
  const codec = normalize(media?.audioCodec) || normalize(part?.audioCodec);

  return {
    partKey: part.key ?? null,
    container,
    codec,
    bitrate: Number.isFinite(media?.bitrate) ? Number(media.bitrate) : null,
    sampleRate: Number.isFinite(media?.audioSamplingRate) ? Number(media.audioSamplingRate) : null,
    bitDepth: Number.isFinite(media?.bitDepth) ? Number(media.bitDepth) : null,
    channels: Number.isFinite(media?.audioChannels) ? Number(media.audioChannels) : null,
    mimeType: mimeForContainer(container, codec),
  };
}
