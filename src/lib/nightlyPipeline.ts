export const NIGHTLY_STAGE_NAMES = [
  "plex_sync",
  "popularity",
  "track_tags",
  "saved_playlist_refresh",
  "audio_features",
] as const;

export type NightlyStageName = typeof NIGHTLY_STAGE_NAMES[number];

export async function runNightlyStageSequence(
  handlers: Record<NightlyStageName, () => Promise<unknown>>,
  onStage?: (event: "started" | "completed", name: NightlyStageName, step: number) => void,
) {
  const results: Partial<Record<NightlyStageName, unknown>> = {};
  for (let index = 0; index < NIGHTLY_STAGE_NAMES.length; index += 1) {
    const name = NIGHTLY_STAGE_NAMES[index];
    onStage?.("started", name, index + 1);
    results[name] = await handlers[name]();
    onStage?.("completed", name, index + 1);
  }
  return results as Record<NightlyStageName, unknown>;
}
