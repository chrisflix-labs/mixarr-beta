import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAudioDbFeatures } from "@/lib/providers/audiodb";
import { getDeezerPopularity, getDeezerTrackTags } from "@/lib/providers/deezer";
import { getDiscogsTrackTags } from "@/lib/providers/discogs";
import { getLastFmPopularity, getLastFmTrackTags } from "@/lib/providers/lastfm";
import { getMusicBrainzTrackTags } from "@/lib/providers/musicbrainz";
import { getSpotifyAudioFeatures, getSpotifyTrackTags } from "@/lib/providers/spotify";
import { getExternalApiDefinition, getExternalApiSettingsPayload, saveExternalApiTestResult } from "@/lib/externalApiSettings";
import { sanitizeErrorText } from "@/lib/supportRedaction";

const TEST_ARTIST = "Coldplay";
const TEST_TRACK = "Yellow";

async function runProviderTest(providerKey: string) {
  if (providerKey === "spotify") {
    const features = await getSpotifyAudioFeatures(TEST_ARTIST, TEST_TRACK);
    return features ? "Connection OK: fetched Spotify audio metadata." : "Connection failed: Spotify did not return audio metadata.";
  }
  if (providerKey === "deezer_tags") {
    const tags = await getDeezerTrackTags(TEST_ARTIST, TEST_TRACK);
    return tags.length ? `Connection OK: fetched ${Math.min(tags.length, 5)} Deezer tags.` : "Connection failed: Deezer did not return tags.";
  }
  if (providerKey === "discogs_tags") {
    const tags = await getDiscogsTrackTags(TEST_ARTIST, TEST_TRACK);
    return tags.length ? `Connection OK: fetched ${Math.min(tags.length, 5)} Discogs tags.` : "Connection failed: Discogs did not return tags.";
  }
  if (providerKey === "musicbrainz_tags") {
    const tags = await getMusicBrainzTrackTags(TEST_ARTIST, TEST_TRACK);
    return tags.length ? `Connection OK: fetched ${Math.min(tags.length, 5)} MusicBrainz tags.` : "Connection failed: MusicBrainz did not return tags.";
  }
  if (providerKey === "spotify_artist_genres") {
    const tags = await getSpotifyTrackTags(TEST_ARTIST, TEST_TRACK);
    return tags.length ? `Connection OK: fetched ${Math.min(tags.length, 5)} Spotify artist genres.` : "Connection failed: Spotify did not return artist genres.";
  }
  if (providerKey === "audiodb") {
    const features = await getAudioDbFeatures(TEST_ARTIST, TEST_TRACK);
    return features ? "Connection OK: fetched AudioDB fallback metadata." : "Connection failed: AudioDB did not return fallback metadata.";
  }
  if (providerKey === "lastfm") {
    const score = await getLastFmPopularity(TEST_ARTIST, TEST_TRACK);
    return score !== null ? "Connection OK: fetched Last.fm popularity." : "Connection failed: Last.fm did not return popularity.";
  }
  if (providerKey === "lastfm_tags") {
    const tags = await getLastFmTrackTags(TEST_ARTIST, TEST_TRACK);
    return tags.length ? `Connection OK: fetched ${Math.min(tags.length, 5)} Last.fm tags.` : "Connection failed: Last.fm did not return tags.";
  }
  if (providerKey === "deezer_popularity") {
    const score = await getDeezerPopularity(TEST_ARTIST, TEST_TRACK);
    return score !== null ? "Connection OK: fetched Deezer popularity." : "Connection failed: Deezer did not return popularity.";
  }
  throw new Error("Unknown external API provider.");
}

export async function POST(_req: Request, { params }: { params: { providerKey: string } }) {
  const userId = cookies().get("mixarr_session")?.value;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const definition = getExternalApiDefinition(params.providerKey);
  if (!definition) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });

  try {
    const message = await runProviderTest(definition.providerKey);
    const success = message.startsWith("Connection OK");
    await saveExternalApiTestResult(definition.providerKey, success, message);
    const payload = await getExternalApiSettingsPayload();
    return NextResponse.json({ success, message: sanitizeErrorText(message, 240), ...payload });
  } catch (error) {
    const message = `Connection failed: ${sanitizeErrorText(error, 200) || "provider test failed"}`;
    await saveExternalApiTestResult(definition.providerKey, false, message);
    const payload = await getExternalApiSettingsPayload();
    return NextResponse.json({ success: false, message, ...payload }, { status: 200 });
  }
}
