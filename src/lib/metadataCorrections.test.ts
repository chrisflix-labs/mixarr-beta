import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bpmCorrectionSuggestions, resolveEffectiveTrackMetadata } from "./metadataCorrections";
import { getTrackBpm, getTrackEnergy } from "./smartMixEngine/v2/metadataFallbacks";
import { getTrackMoodTags } from "./smartMixEngine/v2/moodBlending";
import { validateCorrectionValue, writeCorrection } from "./metadataCorrectionService";

function track(overrides: Record<string, unknown> = {}) {
  return {
    id: "track-1", title: "Test", bpm: 128, effectiveBpm: 128, apiBpm: 128, localBpm: 126, bpmSource: "api",
    tags: [{ type: "mood", name: "Happy" }],
    audioFeature: { apiEnergy: .7, localEnergy: .65, effectiveEnergy: .7, energy: .7, energySource: "api", apiMood: .8, localMood: .7, effectiveMood: .8, valence: .8, valenceSource: "api" },
    metadataCorrections: [], metadataVerifications: [], metadataSourceOverrides: [],
    ...overrides,
  };
}

function correction(field: string, valueJson: unknown, isVerified = true) {
  return { id: `correction-${field}`, field, valueJson, isActive: true, isVerified, updatedAt: new Date(), reason: null };
}

describe("effective track metadata resolver", () => {
  it("manual BPM overrides API and local BPM", () => {
    const value = resolveEffectiveTrackMetadata(track({ metadataCorrections: [correction("bpm", 124)] })).bpm;
    assert.equal(value.value, 124); assert.equal(value.source, "manual"); assert.equal(value.originalValue, 128);
  });

  it("verified API BPM overrides an unverified local preference", () => {
    const value = resolveEffectiveTrackMetadata(track({ effectiveBpm: 126, bpmSource: "local", metadataVerifications: [{ field: "bpm", source: "api", verified: true }] })).bpm;
    assert.equal(value.value, 128); assert.equal(value.source, "api"); assert.equal(value.verified, true);
  });

  it("ignored API BPM is not selected", () => {
    const value = resolveEffectiveTrackMetadata(track({ metadataSourceOverrides: [{ field: "bpm", source: "api", ignored: true }] })).bpm;
    assert.equal(value.value, 126); assert.equal(value.source, "local");
  });

  it("removing a manual correction restores the next valid source", () => {
    const withCorrection = track({ metadataCorrections: [correction("bpm", 90)] });
    assert.equal(resolveEffectiveTrackMetadata(withCorrection).bpm.value, 90);
    assert.equal(resolveEffectiveTrackMetadata({ ...withCorrection, metadataCorrections: [] }).bpm.value, 128);
  });

  it("manual mood supports normalized multiple tags and mood blending", () => {
    const input = track({ metadataCorrections: [correction("mood", ["happy", "Energetic", "HAPPY"])] });
    assert.deepEqual(resolveEffectiveTrackMetadata(input).mood.value, ["Happy", "Energetic"]);
    assert.deepEqual(getTrackMoodTags(input), ["happy", "energetic"]);
  });

  it("manual energy is consumed by scoring getters", () => {
    const input = track({ metadataCorrections: [correction("energy", .92)] });
    assert.equal(getTrackEnergy(input), .92);
  });

  it("missing metadata keeps existing missing fallback behavior", () => {
    const value = resolveEffectiveTrackMetadata(track({ bpm: null, effectiveBpm: null, apiBpm: null, localBpm: null, audioFeature: null, tags: [] }));
    assert.equal(value.bpm.value, null); assert.equal(value.bpm.source, "missing"); assert.equal(value.energy.value, null);
  });

  it("new API observations cannot overwrite a manual correction", () => {
    const input = track({ apiBpm: 62, effectiveBpm: 62, metadataCorrections: [correction("bpm", 124)] });
    assert.equal(getTrackBpm(input), 124); assert.equal(resolveEffectiveTrackMetadata(input).bpm.conflict, true);
  });

  it("half-time and double-time suggestions never mutate the track", () => {
    const input = track({ localBpm: 174 }); const before = JSON.stringify(input);
    const suggestions = bpmCorrectionSuggestions(input);
    assert.ok(suggestions.some((item) => item.value === 87 && item.label === "Half-time"));
    assert.equal(JSON.stringify(input), before);
  });

  it("verification is field-specific", () => {
    const resolved = resolveEffectiveTrackMetadata(track({ metadataVerifications: [{ field: "energy", source: "api", verified: true }] }));
    assert.equal(resolved.energy.verified, true); assert.equal(resolved.bpm.verified, false); assert.equal(resolved.mood.verified, false);
  });

  it("ignoring BPM from a source does not ignore mood from that source", () => {
    const resolved = resolveEffectiveTrackMetadata(track({ metadataSourceOverrides: [{ field: "bpm", source: "api", ignored: true }] }));
    assert.equal(resolved.bpm.source, "local"); assert.equal(resolved.moodScore.source, "api");
  });

  it("ignored embedded mood tags do not participate in mood blending", () => {
    const input = track({ metadataSourceOverrides: [{ field: "mood", source: "embedded", ignored: true }] });
    assert.deepEqual(getTrackMoodTags(input), []);
  });
});

describe("correction validation and audit writes", () => {
  it("rejects invalid BPM and energy instead of clamping", () => {
    assert.throws(() => validateCorrectionValue("bpm", 0), /greater than 0/);
    assert.throws(() => validateCorrectionValue("energy", 1.1), /between 0 and 1/);
  });

  it("writes history for each mutation and preserves a shared bulk batch ID", async () => {
    const histories: any[] = [];
    const fake = {
      trackMetadataCorrection: { update: async () => ({}), create: async ({ data }: any) => ({ id: crypto.randomUUID(), ...data }) },
      trackMetadataCorrectionHistory: { create: async ({ data }: any) => { histories.push(data); return data; } },
    } as any;
    const batchId = crypto.randomUUID();
    const input = track() as any;
    await writeCorrection(fake, { track: input, userId: "user-1", field: "bpm", value: 120, batchId });
    await writeCorrection(fake, { track: { ...input, id: "track-2" }, userId: "user-1", field: "bpm", value: 122, batchId });
    assert.equal(histories.length, 2); assert.ok(histories.every((item) => item.batchId === batchId));
  });
});
