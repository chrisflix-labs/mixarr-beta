import prisma from "./prisma";
import { envFlag } from "./envBoolean";
import { decryptSecret, encryptSecret, isSecretEncryptionConfigured, maskSecret } from "./secretStorage";
import { sanitizeErrorText } from "./supportRedaction";

export type ExternalApiUse = "popularity" | "tags" | "bpm" | "audioFeatures";
export type CredentialSource = "ui" | "env" | "none";
export type ExternalApiProviderKey =
  | "spotify"
  | "deezer_tags"
  | "discogs_tags"
  | "musicbrainz_tags"
  | "spotify_artist_genres"
  | "audiodb"
  | "lastfm"
  | "lastfm_tags"
  | "deezer_popularity";

export type ExternalApiCredentials = Record<string, string>;

type ProviderDefinition = {
  providerKey: ExternalApiProviderKey;
  name: string;
  shortName: string;
  icon: string;
  description: string;
  supportedUses: ExternalApiUse[];
  credentialFields: Array<{ key: string; label: string; secret?: boolean; required?: boolean }>;
  credentialProviderKey?: ExternalApiProviderKey;
  defaultEnabled: () => boolean;
  defaultUses: Partial<Record<ExternalApiUse, boolean>>;
  envCredentials: () => ExternalApiCredentials;
  envEnabledLabel?: string;
};

function envEnabled(name: string, defaultValue: boolean) {
  return envFlag(name, defaultValue);
}

function pickFilled(input: ExternalApiCredentials) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => typeof value === "string" && value.trim().length > 0),
  );
}

function hasValues(input: ExternalApiCredentials, keys: string[]) {
  return keys.every((key) => Boolean(input[key]?.trim()));
}

export const externalApiProviderDefinitions: ProviderDefinition[] = [
  {
    providerKey: "spotify",
    name: "Spotify Audio Features",
    shortName: "Spotify",
    icon: "spotify",
    description: "Optional Spotify metadata for audio features and popularity fallback where available.",
    supportedUses: ["audioFeatures", "popularity"],
    credentialFields: [
      { key: "clientId", label: "Client ID", required: true },
      { key: "clientSecret", label: "Client Secret", secret: true, required: true },
    ],
    defaultEnabled: () => hasValues(spotifyEnvCredentials(), ["clientId", "clientSecret"]),
    defaultUses: { audioFeatures: true, popularity: true },
    envCredentials: spotifyEnvCredentials,
  },
  {
    providerKey: "deezer_tags",
    name: "Deezer Genre Tags",
    shortName: "Deezer",
    icon: "deezer",
    description: "Free/public Deezer album genre tags for track metadata enrichment.",
    supportedUses: ["tags"],
    credentialFields: [],
    defaultEnabled: () => envEnabled("DEEZER_TAGS_ENABLED", true),
    defaultUses: { tags: true },
    envCredentials: () => ({}),
    envEnabledLabel: "Active Free Tier",
  },
  {
    providerKey: "discogs_tags",
    name: "Discogs Genre Tags",
    shortName: "Discogs",
    icon: "discogs",
    description: "Opt-in Discogs release genre/style tags using consumer credentials.",
    supportedUses: ["tags"],
    credentialFields: [
      { key: "consumerKey", label: "Consumer Key", required: true },
      { key: "consumerSecret", label: "Consumer Secret", secret: true, required: true },
    ],
    defaultEnabled: () => envEnabled("DISCOGS_TAGS_ENABLED", false) && hasValues(discogsEnvCredentials(), ["consumerKey", "consumerSecret"]),
    defaultUses: { tags: true },
    envCredentials: discogsEnvCredentials,
  },
  {
    providerKey: "musicbrainz_tags",
    name: "MusicBrainz Genre Tags",
    shortName: "MusicBrainz",
    icon: "musicbrainz",
    description: "Free MusicBrainz genre/tag lookup with a meaningful User-Agent/contact.",
    supportedUses: ["tags"],
    credentialFields: [
      { key: "userAgent", label: "User-Agent / Contact", required: true },
    ],
    defaultEnabled: () => envEnabled("MUSICBRAINZ_TAGS_ENABLED", true),
    defaultUses: { tags: true },
    envCredentials: musicBrainzEnvCredentials,
  },
  {
    providerKey: "spotify_artist_genres",
    name: "Spotify Artist Genres",
    shortName: "Spotify Genres",
    icon: "spotify",
    description: "Optional Spotify artist-genre lookup using the saved Spotify credentials.",
    supportedUses: ["tags"],
    credentialFields: [],
    credentialProviderKey: "spotify",
    defaultEnabled: () => envEnabled("SPOTIFY_TAGS_ENABLED", false) && hasValues(spotifyEnvCredentials(), ["clientId", "clientSecret"]),
    defaultUses: { tags: true },
    envCredentials: spotifyEnvCredentials,
  },
  {
    providerKey: "audiodb",
    name: "AudioDB Fallback",
    shortName: "AudioDB",
    icon: "audiodb",
    description: "Free-tier mood/audio-feature fallback used when richer providers do not return values.",
    supportedUses: ["audioFeatures"],
    credentialFields: [],
    defaultEnabled: () => envEnabled("AUDIODB_ENABLED", true),
    defaultUses: { audioFeatures: true },
    envCredentials: () => ({}),
    envEnabledLabel: "Active Free Tier",
  },
  {
    providerKey: "lastfm",
    name: "Last.fm Popularity",
    shortName: "Last.fm",
    icon: "lastfm",
    description: "Last.fm track playcount popularity using an API key.",
    supportedUses: ["popularity"],
    credentialFields: [
      { key: "apiKey", label: "API Key", secret: true, required: true },
    ],
    defaultEnabled: () => hasValues(lastFmEnvCredentials(), ["apiKey"]),
    defaultUses: { popularity: true },
    envCredentials: lastFmEnvCredentials,
  },
  {
    providerKey: "lastfm_tags",
    name: "Last.fm Tag Fallback",
    shortName: "Last.fm Tags",
    icon: "lastfm",
    description: "Final tag fallback using the saved Last.fm API key.",
    supportedUses: ["tags"],
    credentialFields: [],
    credentialProviderKey: "lastfm",
    defaultEnabled: () => envEnabled("LASTFM_TAG_FALLBACK_ENABLED", true) && hasValues(lastFmEnvCredentials(), ["apiKey"]),
    defaultUses: { tags: true },
    envCredentials: lastFmEnvCredentials,
  },
  {
    providerKey: "deezer_popularity",
    name: "Deezer Popularity",
    shortName: "Deezer",
    icon: "deezer",
    description: "Free/public Deezer popularity and BPM lookup used as optional API enrichment.",
    supportedUses: ["popularity", "bpm"],
    credentialFields: [],
    defaultEnabled: () => envEnabled("DEEZER_POPULARITY_ENABLED", true),
    defaultUses: { popularity: true, bpm: true },
    envCredentials: () => ({}),
    envEnabledLabel: "Active Free Tier",
  },
];

function spotifyEnvCredentials() {
  return pickFilled({
    clientId: process.env.SPOTIFY_CLIENT_ID || "",
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET || "",
  });
}

function discogsEnvCredentials() {
  return pickFilled({
    consumerKey: process.env.DISCOGS_CONSUMER_KEY || "",
    consumerSecret: process.env.DISCOGS_CONSUMER_SECRET || "",
  });
}

function musicBrainzEnvCredentials() {
  return pickFilled({
    userAgent: process.env.MUSICBRAINZ_USER_AGENT || "Mixarr/1.0 (local self-hosted playlist tool)",
  });
}

function lastFmEnvCredentials() {
  return pickFilled({
    apiKey: process.env.LASTFM_API_KEY || "",
  });
}

export function getExternalApiDefinition(providerKey: string) {
  return externalApiProviderDefinitions.find((definition) => definition.providerKey === providerKey) || null;
}

function settingToUses(setting: any, definition: ProviderDefinition) {
  return {
    popularity: definition.supportedUses.includes("popularity") ? Boolean(setting?.usesPopularity ?? definition.defaultUses.popularity ?? false) : false,
    tags: definition.supportedUses.includes("tags") ? Boolean(setting?.usesTags ?? definition.defaultUses.tags ?? false) : false,
    bpm: definition.supportedUses.includes("bpm") ? Boolean(setting?.usesBpm ?? definition.defaultUses.bpm ?? false) : false,
    audioFeatures: definition.supportedUses.includes("audioFeatures") ? Boolean(setting?.usesAudioFeatures ?? definition.defaultUses.audioFeatures ?? false) : false,
  };
}

async function readUiCredentials(providerKey: ExternalApiProviderKey): Promise<ExternalApiCredentials | null> {
  const row = await prisma.providerSetting.findUnique({
    where: { providerKey },
    select: { encryptedCredentials: true },
  });
  if (!row?.encryptedCredentials) return null;
  const decrypted = decryptSecret(row.encryptedCredentials);
  return JSON.parse(decrypted);
}

async function hasUiCredentials(providerKey: ExternalApiProviderKey) {
  const row = await prisma.providerSetting.findUnique({
    where: { providerKey },
    select: { encryptedCredentials: true },
  });
  return Boolean(row?.encryptedCredentials);
}

export async function resolveProviderCredentials(providerKey: ExternalApiProviderKey): Promise<{ source: CredentialSource; credentials: ExternalApiCredentials }> {
  const definition = getExternalApiDefinition(providerKey);
  if (!definition) return { source: "none", credentials: {} };
  const credentialProviderKey = definition.credentialProviderKey || definition.providerKey;
  try {
    const uiCredentials = await readUiCredentials(credentialProviderKey);
    if (uiCredentials && Object.keys(uiCredentials).length > 0) {
      return { source: "ui", credentials: uiCredentials };
    }
  } catch {
    return { source: "none", credentials: {} };
  }
  const envCredentials = definition.envCredentials();
  return Object.keys(envCredentials).length > 0
    ? { source: "env", credentials: envCredentials }
    : { source: "none", credentials: {} };
}

export async function getSpotifyCredentials() {
  const resolved = await resolveProviderCredentials("spotify");
  return hasValues(resolved.credentials, ["clientId", "clientSecret"])
    ? { clientId: resolved.credentials.clientId, clientSecret: resolved.credentials.clientSecret }
    : null;
}

export async function getDiscogsCredentials() {
  const resolved = await resolveProviderCredentials("discogs_tags");
  return hasValues(resolved.credentials, ["consumerKey", "consumerSecret"])
    ? { consumerKey: resolved.credentials.consumerKey, consumerSecret: resolved.credentials.consumerSecret }
    : null;
}

export async function getMusicBrainzUserAgent() {
  const resolved = await resolveProviderCredentials("musicbrainz_tags");
  return resolved.credentials.userAgent || "Mixarr/1.0 (local self-hosted playlist tool)";
}

export async function getLastFmCredentials() {
  const resolved = await resolveProviderCredentials("lastfm");
  return hasValues(resolved.credentials, ["apiKey"]) ? { apiKey: resolved.credentials.apiKey } : null;
}

async function credentialStatus(definition: ProviderDefinition) {
  const credentialProviderKey = definition.credentialProviderKey || definition.providerKey;
  const credentialDefinition = getExternalApiDefinition(credentialProviderKey) || definition;
  const [hasUi, resolved] = await Promise.all([
    hasUiCredentials(credentialProviderKey),
    resolveProviderCredentials(definition.providerKey),
  ]);
  const requiresCredentials = credentialDefinition.credentialFields.some((field) => field.required);
  const hasCredentials = !requiresCredentials || Object.keys(resolved.credentials).length > 0;
  const primarySecretKey = credentialDefinition.credentialFields.find((field) => field.secret)?.key || credentialDefinition.credentialFields[0]?.key;
  return {
    credentialSource: hasUi ? "ui" as CredentialSource : resolved.source,
    hasCredentials,
    maskedCredential: hasUi
      ? maskSecret(resolved.credentials[primarySecretKey] || "saved")
      : resolved.source === "env"
        ? "Configured via .env"
        : null,
  };
}

function displayStatus(definition: ProviderDefinition, enabled: boolean, hasCredentials: boolean, credentialSource: CredentialSource, lastTestStatus?: string | null) {
  if (lastTestStatus === "failed") return "Connection failed";
  if (!enabled) return "Disabled";
  const credentialProviderKey = definition.credentialProviderKey || definition.providerKey;
  const credentialDefinition = getExternalApiDefinition(credentialProviderKey) || definition;
  const requiresCredentials = credentialDefinition.credentialFields.some((field) => field.required);
  if (requiresCredentials && !hasCredentials) {
    if (definition.providerKey === "musicbrainz_tags") return "Missing User-Agent";
    if (definition.providerKey === "lastfm") return "Missing API key";
    return "Missing credentials";
  }
  if (definition.envEnabledLabel && credentialSource !== "ui") return definition.envEnabledLabel;
  if (definition.credentialProviderKey && credentialSource === "ui") return `Uses ${definition.credentialProviderKey === "spotify" ? "Spotify" : "Last.fm"} credentials`;
  if (credentialSource === "ui") return "Configured in UI";
  if (credentialSource === "env") return "Configured via .env";
  return enabled ? "Enabled" : "Not configured";
}

export async function getExternalApiSettingsPayload() {
  const rows = await prisma.providerSetting.findMany();
  const rowsByKey = new Map(rows.map((row) => [row.providerKey, row]));
  const providers = await Promise.all(externalApiProviderDefinitions.map(async (definition) => {
    const row = rowsByKey.get(definition.providerKey);
    const enabled = Boolean(row?.enabled ?? definition.defaultEnabled());
    const uses = settingToUses(row, definition);
    const credentials = await credentialStatus(definition);
    const status = displayStatus(definition, enabled, credentials.hasCredentials, credentials.credentialSource, row?.lastTestStatus);

    return {
      providerKey: definition.providerKey,
      name: definition.name,
      shortName: definition.shortName,
      icon: definition.icon,
      description: definition.description,
      supportedUses: definition.supportedUses,
      credentialFields: definition.credentialFields.map((field) => ({
        key: field.key,
        label: field.label,
        secret: Boolean(field.secret),
        required: Boolean(field.required),
      })),
      credentialSource: credentials.credentialSource,
      hasCredentials: credentials.hasCredentials,
      maskedCredential: credentials.maskedCredential,
      enabled,
      uses,
      status,
      lastTestStatus: row?.lastTestStatus || null,
      lastTestMessage: row?.lastTestMessage || null,
      lastTestAt: row?.lastTestAt?.toISOString?.() || null,
    };
  }));

  return {
    encryption: {
      configured: isSecretEncryptionConfigured(),
      warning: isSecretEncryptionConfigured() ? null : "Secret encryption key is not configured. API credentials cannot be saved from the UI.",
    },
    providers,
    summary: summarizeExternalApiProviders(providers),
    providerOrder: {
      popularity: providers.filter((provider) => provider.enabled && provider.uses.popularity).map((provider) => provider.name),
      tags: providers.filter((provider) => provider.enabled && provider.uses.tags).map((provider) => provider.name),
      bpm: providers.filter((provider) => provider.enabled && provider.uses.bpm).map((provider) => provider.name),
      audioFeatures: providers.filter((provider) => provider.enabled && provider.uses.audioFeatures).map((provider) => provider.name),
    },
  };
}

export function summarizeExternalApiProviders(providers: Array<{ enabled: boolean; shortName: string; uses: Record<ExternalApiUse, boolean> }>) {
  const namesFor = (use: ExternalApiUse) => providers
    .filter((provider) => provider.enabled && provider.uses[use])
    .map((provider) => provider.shortName);

  return {
    popularity: namesFor("popularity"),
    tags: namesFor("tags"),
    bpm: namesFor("bpm"),
    audioFeatures: namesFor("audioFeatures"),
    allDisabled: providers.every((provider) => !provider.enabled),
  };
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

export async function saveExternalApiProviderSetting(providerKey: string, input: any) {
  const definition = getExternalApiDefinition(providerKey);
  if (!definition) throw new Error("Unknown external API provider.");
  const existing = await prisma.providerSetting.findUnique({ where: { providerKey: definition.providerKey } });
  const uses = settingToUses(existing, definition);
  const nextUses = {
    popularity: normalizeBoolean(input?.uses?.popularity, uses.popularity),
    tags: normalizeBoolean(input?.uses?.tags, uses.tags),
    bpm: normalizeBoolean(input?.uses?.bpm, uses.bpm),
    audioFeatures: normalizeBoolean(input?.uses?.audioFeatures, uses.audioFeatures),
  };
  const data: any = {
    enabled: normalizeBoolean(input?.enabled, Boolean(existing?.enabled ?? definition.defaultEnabled())),
    usesPopularity: definition.supportedUses.includes("popularity") ? nextUses.popularity : false,
    usesTags: definition.supportedUses.includes("tags") ? nextUses.tags : false,
    usesBpm: definition.supportedUses.includes("bpm") ? nextUses.bpm : false,
    usesAudioFeatures: definition.supportedUses.includes("audioFeatures") ? nextUses.audioFeatures : false,
  };

  const incomingCredentials = input?.credentials && typeof input.credentials === "object"
    ? pickFilled(input.credentials)
    : {};
  if (Object.keys(incomingCredentials).length > 0) {
    if (!definition.credentialFields.length) throw new Error("This provider does not accept credentials.");
    const allowedKeys = new Set(definition.credentialFields.map((field) => field.key));
    const sanitizedCredentials = Object.fromEntries(
      Object.entries(incomingCredentials)
        .filter(([key]) => allowedKeys.has(key))
        .map(([key, value]) => [key, String(value).trim()]),
    );
    const missing = definition.credentialFields
      .filter((field) => field.required)
      .filter((field) => !sanitizedCredentials[field.key]);
    if (missing.length > 0) {
      throw new Error(`Missing required credential: ${missing[0].label}.`);
    }
    data.encryptedCredentials = encryptSecret(JSON.stringify(sanitizedCredentials));
  }

  const setting = await prisma.providerSetting.upsert({
    where: { providerKey: definition.providerKey },
    update: data,
    create: { providerKey: definition.providerKey, ...data },
  });

  return setting;
}

export async function removeExternalApiProviderCredentials(providerKey: string) {
  const definition = getExternalApiDefinition(providerKey);
  if (!definition) throw new Error("Unknown external API provider.");
  await prisma.providerSetting.upsert({
    where: { providerKey: definition.providerKey },
    update: { encryptedCredentials: null },
    create: {
      providerKey: definition.providerKey,
      enabled: definition.defaultEnabled(),
      usesPopularity: Boolean(definition.defaultUses.popularity),
      usesTags: Boolean(definition.defaultUses.tags),
      usesBpm: Boolean(definition.defaultUses.bpm),
      usesAudioFeatures: Boolean(definition.defaultUses.audioFeatures),
      encryptedCredentials: null,
    },
  });
}

export async function saveExternalApiTestResult(providerKey: string, success: boolean, message: string) {
  const definition = getExternalApiDefinition(providerKey);
  if (!definition) return;
  await prisma.providerSetting.upsert({
    where: { providerKey: definition.providerKey },
    update: {
      lastTestStatus: success ? "ok" : "failed",
      lastTestMessage: sanitizeErrorText(message, 240),
      lastTestAt: new Date(),
    },
    create: {
      providerKey: definition.providerKey,
      enabled: definition.defaultEnabled(),
      usesPopularity: Boolean(definition.defaultUses.popularity),
      usesTags: Boolean(definition.defaultUses.tags),
      usesBpm: Boolean(definition.defaultUses.bpm),
      usesAudioFeatures: Boolean(definition.defaultUses.audioFeatures),
      lastTestStatus: success ? "ok" : "failed",
      lastTestMessage: sanitizeErrorText(message, 240),
      lastTestAt: new Date(),
    },
  });
}

let runtimeCache: { expiresAt: number; payload: Awaited<ReturnType<typeof getExternalApiSettingsPayload>> } | null = null;

export async function getExternalApiRuntimeConfig(options: { cache?: boolean } = {}) {
  if (options.cache !== false && runtimeCache && runtimeCache.expiresAt > Date.now()) return runtimeCache.payload;
  const payload = await getExternalApiSettingsPayload();
  runtimeCache = { payload, expiresAt: Date.now() + 5000 };
  return payload;
}

export async function getEnabledExternalApiProviders(use: ExternalApiUse) {
  const payload = await getExternalApiRuntimeConfig({ cache: true });
  return payload.providers
    .filter((provider) => provider.enabled && provider.uses[use])
    .map((provider) => provider.providerKey as ExternalApiProviderKey);
}

export async function isExternalApiProviderEnabled(providerKey: ExternalApiProviderKey, use: ExternalApiUse) {
  const providers = await getEnabledExternalApiProviders(use);
  return providers.includes(providerKey);
}

export async function getExternalApiDiagnostics() {
  const payload = await getExternalApiSettingsPayload();
  return Object.fromEntries(payload.providers.map((provider) => [
    provider.providerKey,
    {
      enabled: provider.enabled,
      credentialSource: provider.credentialSource,
      uses: Object.entries(provider.uses).filter(([, enabled]) => enabled).map(([use]) => use),
      lastTestStatus: provider.lastTestStatus,
    },
  ]));
}
