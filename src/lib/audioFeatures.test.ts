import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  auditAudioFeatureHealthGap,
  apiAudioFeatureTrackWhere,
  audioFeatureFilterGuardWhere,
  classifyAudioFeatureTracks,
  enforceAudioFeatureIncompleteInvariant,
  getAudioFeatureHealthStatus,
  audioFeatureRetryEligibilityTrackWhere,
  completeAudioFeatureTrackWhere,
  getEffectiveAudioFeatures,
  heuristicAudioFeatureTrackWhere,
  incompleteAudioFeatureTrackWhere,
  localEssentiaAudioFeatureSuccessTrackWhere,
  mergeAudioFeatureHealthGapCounts,
  missingAudioFeatureTrackWhere,
  noAudioFeatureRecordTrackWhere,
  pendingAudioFeatureTrackWhere,
  partialAudioFeatureTrackWhere,
} from "./audioFeatures";

describe("audio feature health predicates", () => {
  it("does not count neutral placeholder rows as complete audio features", () => {
    const complete = JSON.stringify(completeAudioFeatureTrackWhere());
    assert.match(complete, /energy/);
    assert.match(complete, /valence/);
    assert.match(complete, /danceability/);
    assert.match(complete, /tempo/);
    assert.match(complete, /Deezer BPM only/);
    assert.match(complete, /Unknown Mood/);
    assert.match(complete, /not_found/);

    const missing = JSON.stringify(missingAudioFeatureTrackWhere());
    assert.match(missing, /NOT/);
    assert.match(missing, /audioFeature/);
    assert.match(missing, /bpmSource/);
  });

  it("uses an explicit missing relation predicate for active tracks with no audio feature row", () => {
    assert.deepEqual(noAudioFeatureRecordTrackWhere(), { audioFeature: { is: null } });
    const missing = JSON.stringify(missingAudioFeatureTrackWhere());
    assert.match(missing, /bpmSource/);
    assert.match(missing, /tempoSource/);
    assert.match(missing, /audioFeatureStatus/);
    assert.match(missing, /pending/);
    assert.match(missing, /no_data/);
  });

  it("separates API, local, and heuristic feature sources", () => {
    assert.match(JSON.stringify(apiAudioFeatureTrackWhere()), /api/);
    assert.match(JSON.stringify(heuristicAudioFeatureTrackWhere()), /local_heuristic/);
  });

  it("excludes heuristic field values from filters unless explicitly allowed", () => {
    const strict = JSON.stringify(audioFeatureFilterGuardWhere("valenceSource", {
      includeEstimated: false,
      minimumConfidence: 0.7,
    }));
    assert.match(strict, /local_heuristic/);
    assert.match(strict, /audioFeatureConfidence/);

    const permissive = JSON.stringify(audioFeatureFilterGuardWhere("valenceSource", {
      includeEstimated: true,
      minimumConfidence: null,
    }));
    assert.doesNotMatch(permissive, /valenceSource/);
  });

  it("treats complete local Essentia success as effective local audio features", () => {
    const effective = getEffectiveAudioFeatures({
      audioFeature: {
        energy: 0.15,
        valence: 0.25,
        danceability: 0.35,
        acousticness: 0.45,
        tempo: 122.5,
        localEnergy: 0.8,
        localMood: 0.7,
        localDanceability: 0.6,
        localAcousticness: 0.5,
        audioFeatureSource: "local_essentia",
        audioFeatureStatus: "success",
        audioFeatureConfidence: 0.95,
        audioFeatureAnalysisScope: "whole_track",
      },
    }, { preferLocalAudioFeatures: true });

    assert.equal(effective.complete, true);
    assert.equal(effective.source, "local_essentia");
    assert.equal(effective.energy, 0.8);
    assert.equal(effective.mood, 0.7);
    assert.deepEqual(effective.missingFields, []);
  });

  it("lets local Essentia fields satisfy health when API features are disabled", () => {
    const effective = getEffectiveAudioFeatures({
      audioFeature: {
        localEnergy: 0.8,
        localMood: 0.7,
        localDanceability: 0.6,
        localAcousticness: 0.5,
        tempo: 121,
        audioFeatureSource: "local_essentia",
        audioFeatureStatus: "success",
        energySource: "local_essentia",
        valenceSource: "local_essentia",
        danceabilitySource: "local_essentia",
        acousticnessSource: "local_essentia",
      },
    }, { preferLocalAudioFeatures: true, allowEstimated: false });

    assert.equal(effective.complete, true);
    assert.equal(effective.partial, false);
    assert.deepEqual(effective.missingFields, []);
  });

  it("does not treat stale partial status as partial when all persisted local fields are valid", () => {
    const effective = getEffectiveAudioFeatures({
      audioFeature: {
        localEnergy: 0.42,
        localMood: 0.53,
        localDanceability: 0.64,
        localAcousticness: 0.25,
        tempo: 118,
        audioFeatureSource: "local_essentia",
        audioFeatureStatus: "partial",
      },
    }, { preferLocalAudioFeatures: true });

    assert.equal(effective.complete, true);
    assert.equal(effective.partial, false);
  });

  it("keeps truly incomplete persisted feature data partial and names missing fields", () => {
    const effective = getEffectiveAudioFeatures({
      audioFeature: {
        localEnergy: 0.42,
        localMood: null,
        localDanceability: 0.64,
        localAcousticness: 0.25,
        tempo: 118,
        audioFeatureSource: "local_essentia",
        audioFeatureStatus: "partial",
      },
    }, { preferLocalAudioFeatures: true });

    assert.equal(effective.complete, false);
    assert.equal(effective.partial, true);
    assert.deepEqual(effective.missingFields, ["mood"]);
  });

  it("honors provider priority when API and local features both exist", () => {
    const track = {
      audioFeature: {
        apiEnergy: 0.2,
        apiMood: 0.3,
        apiDanceability: 0.4,
        apiAcousticness: 0.5,
        localEnergy: 0.7,
        localMood: 0.6,
        localDanceability: 0.5,
        localAcousticness: 0.4,
        tempo: 120,
        audioFeatureSource: "mixed",
        audioFeatureStatus: "success",
        source: "Spotify Audio Features",
      },
    };

    assert.equal(getEffectiveAudioFeatures(track, { preferLocalAudioFeatures: true }).energy, 0.7);
    assert.equal(getEffectiveAudioFeatures(track, { preferLocalAudioFeatures: false }).energy, 0.2);
  });

  it("requires local or allowed estimated fields when API audio features are disabled", () => {
    const apiOnlyTrack = {
      audioFeature: {
        apiEnergy: 0.2,
        apiMood: 0.3,
        apiDanceability: 0.4,
        apiAcousticness: 0.5,
        tempo: 120,
        audioFeatureSource: "api",
        audioFeatureStatus: "success",
        source: "Spotify Audio Features",
      },
    };

    const localOnly = getEffectiveAudioFeatures(apiOnlyTrack, { api: false, local: true, preferLocalAudioFeatures: true });
    const apiEnabled = getEffectiveAudioFeatures(apiOnlyTrack, { api: true, local: false });
    const classification = getAudioFeatureHealthStatus(apiOnlyTrack, { api: false, local: true, preferLocalAudioFeatures: true });

    assert.equal(localOnly.complete, false);
    assert.equal(apiEnabled.complete, true);
    assert.equal(classification.status, "partial");
    assert.equal(classification.reason, "API data only");
  });

  it("does not count fake neutral placeholders as complete effective features", () => {
    const effective = getEffectiveAudioFeatures({
      audioFeature: {
        energy: 0.5,
        valence: 0.5,
        danceability: 0.5,
        acousticness: 0.5,
        tempo: 120,
        source: "Unknown Mood estimated",
        audioFeatureSource: "local_heuristic",
        audioFeatureStatus: "no_data",
        audioFeatureConfidence: 0,
      },
    }, { preferLocalAudioFeatures: true, allowEstimated: true });

    assert.equal(effective.complete, false);
    assert.match(JSON.stringify(completeAudioFeatureTrackWhere()), /audioFeatureStatus/);
  });

  it("keeps complete local Essentia rows out of partial and retry predicates", () => {
    const partial = JSON.stringify(partialAudioFeatureTrackWhere());
    const retry = JSON.stringify(audioFeatureRetryEligibilityTrackWhere({ providerMode: "configured", analysisScope: "whole_track" }));
    const localSuccess = JSON.stringify(localEssentiaAudioFeatureSuccessTrackWhere("whole_track"));

    assert.match(partial, /partial/);
    assert.match(partial, /NOT/);
    assert.match(partial, /localEnergy/);
    assert.match(partial, /localMood/);
    assert.match(retry, /local_essentia/);
    assert.match(retry, /too_short/);
    assert.match(localSuccess, /whole_track/);
    assert.match(localSuccess, /success/);
  });

  it("uses the same provider-aware predicate for missing, partial, pending, and retry filters", () => {
    const settings = { api: false, local: true, preferLocalAudioFeatures: true };
    const missing = JSON.stringify(missingAudioFeatureTrackWhere(settings));
    const partial = JSON.stringify(partialAudioFeatureTrackWhere(settings));
    const pending = JSON.stringify(pendingAudioFeatureTrackWhere(settings));
    const retry = JSON.stringify(audioFeatureRetryEligibilityTrackWhere({ providerMode: "configured", settings, analysisScope: "whole_track" }));

    assert.match(missing, /bpmSource/);
    assert.match(missing, /audioFeatureStatus/);
    assert.match(partial, /apiEnergy/);
    assert.match(partial, /bpmSource/);
    assert.match(partial, /tempoSource/);
    assert.equal(partial.includes(JSON.stringify(missingAudioFeatureTrackWhere())), false);
    assert.match(pending, /too_short/);
    assert.match(retry, /too_short/);
    assert.match(retry, /local_essentia/);
  });

  it("audits active complete and classified audio feature gaps", () => {
    const audit = auditAudioFeatureHealthGap({
      activeTracks: 10,
      completeAudioFeatures: 8,
      missing: 0,
      partial: 0,
      pending: 0,
      noData: 0,
      failed: 0,
      tooShort: 0,
      noAudioFeatureRecord: 2,
    });

    assert.equal(audit.incompleteExpected, 2);
    assert.equal(audit.unclassifiedGap, 2);
    assert.equal(audit.classifiedAsMissing, 0);
    assert.equal(audit.gapDetected, true);
  });

  it("leaves detected audio gaps unassigned until metadata inspection splits them", () => {
    const merged = mergeAudioFeatureHealthGapCounts({
      activeTracks: 10,
      completeAudioFeatures: 8,
      missing: 0,
      partial: 0,
      pending: 0,
      noData: 0,
      failed: 0,
      tooShort: 0,
      noAudioFeatureRecord: 2,
    });

    assert.equal(merged.audit.incompleteExpected, 2);
    assert.equal(merged.audit.unclassifiedGap, 2);
    assert.equal(merged.gapOnly, 2);
    assert.equal(merged.missing, 0);
    assert.equal(merged.pending, 0);
  });

  it("does not lose the remaining active track when one incomplete track is already classified", () => {
    const audit = auditAudioFeatureHealthGap({
      activeTracks: 10,
      completeAudioFeatures: 8,
      missing: 0,
      partial: 1,
      pending: 0,
      noData: 0,
      failed: 0,
      tooShort: 0,
      noAudioFeatureRecord: 1,
    });

    assert.equal(audit.incompleteExpected, 2);
    assert.equal(audit.classifiedIncomplete, 1);
    assert.equal(audit.unclassifiedGap, 1);
    assert.equal(audit.classifiedAsMissing, 0);
  });

  it("classifies no-record audio gaps for matching summary, detail, and retry sets", () => {
    const completeFeature = {
      localEnergy: 0.7,
      localMood: 0.6,
      localDanceability: 0.5,
      localAcousticness: 0.4,
      tempo: 120,
      audioFeatureSource: "local_essentia",
      audioFeatureStatus: "success",
      energySource: "local_essentia",
      valenceSource: "local_essentia",
      danceabilitySource: "local_essentia",
      acousticnessSource: "local_essentia",
    };
    const tracks = Array.from({ length: 10 }, (_, index) => ({
      id: `track-${index + 1}`,
      syncStatus: "active",
      audioFeature: index < 8 ? completeFeature : null,
    }));

    const classified = classifyAudioFeatureTracks(tracks, {
      api: false,
      local: true,
      preferLocalAudioFeatures: true,
    });

    assert.equal(classified.counts.complete, 8);
    assert.equal(classified.counts.missing_audio_features, 2);
    assert.equal(classified.counts.pending_audio_features, 2);
    assert.deepEqual(classified.matchingTrackIds.missing_audio_features, ["track-9", "track-10"]);
    assert.deepEqual(classified.matchingTrackIds.pending_audio_features, ["track-9", "track-10"]);
    assert.equal(classified.matchingTrackIds.pending_audio_features.length, 2);
  });

  it("classifies BPM-only incomplete audio feature rows as partial and pending, not missing", () => {
    const completeFeature = {
      localEnergy: 0.7,
      localMood: 0.6,
      localDanceability: 0.5,
      localAcousticness: 0.4,
      tempo: 120,
      audioFeatureSource: "local_essentia",
      audioFeatureStatus: "success",
      energySource: "local_essentia",
      valenceSource: "local_essentia",
      danceabilitySource: "local_essentia",
      acousticnessSource: "local_essentia",
    };
    const tracks = Array.from({ length: 10 }, (_, index) => ({
      id: `track-${index + 1}`,
      syncStatus: "active",
      bpm: index >= 8 ? 124 : null,
      bpmSource: index >= 8 ? "Deezer" : null,
      mediaPath: index >= 8 ? "C:/Music/song.flac" : null,
      audioFeature: index < 8 ? completeFeature : {
        audioFeatureStatus: "partial",
        audioFeatureSource: null,
        localEnergy: null,
        localMood: null,
        localDanceability: null,
        localAcousticness: null,
        tempo: null,
      },
    }));

    const classified = classifyAudioFeatureTracks(tracks, {
      api: false,
      local: true,
      preferLocalAudioFeatures: true,
    });

    assert.equal(classified.counts.complete, 8);
    assert.equal(classified.counts.partial_audio_features, 2);
    assert.equal(classified.counts.missing_audio_features, 0);
    assert.equal(classified.counts.pending_audio_features, 2);
    assert.deepEqual(classified.matchingTrackIds.partial_audio_features, ["track-9", "track-10"]);
    assert.deepEqual(classified.matchingTrackIds.pending_audio_features, ["track-9", "track-10"]);
  });

  it("classifies audio-feature tempo-source-only rows as partial and pending, not missing", () => {
    const track = {
      id: "track-tempo-source",
      syncStatus: "active",
      bpm: null,
      bpmSource: null,
      audioFeature: {
        tempo: 91.1,
        tempoSource: "Deezer",
        audioFeatureStatus: null,
        energy: null,
        valence: null,
        danceability: null,
        acousticness: null,
        localEnergy: null,
        localMood: null,
        localDanceability: null,
        localAcousticness: null,
      },
    };

    const classified = classifyAudioFeatureTracks([track], {
      api: false,
      local: true,
      preferLocalAudioFeatures: true,
    });

    assert.equal(getAudioFeatureHealthStatus(track, { api: false, local: true }).status, "partial");
    assert.equal(classified.counts.partial_audio_features, 1);
    assert.equal(classified.counts.missing_audio_features, 0);
    assert.equal(classified.counts.pending_audio_features, 1);
  });

  it("guards complete audio feature fields against NULL so NOT complete stays reliable", () => {
    // Root cause of the incomplete-count mismatch: a partial audio feature row
    // that fails completeness only via a NULL comparison makes the whole
    // predicate SQL NULL, and NOT(NULL) drops the row from both complete and
    // incomplete result sets. Requiring the field to be non-null keeps the
    // positive match identical while making the negation well-defined.
    const complete = JSON.stringify(completeAudioFeatureTrackWhere());
    assert.match(complete, /"not":null/);
    assert.match(complete, /localEnergy/);
    assert.match(complete, /tempo/);

    const incomplete = JSON.stringify(incompleteAudioFeatureTrackWhere());
    assert.match(incomplete, /NOT/);
    assert.match(incomplete, /"not":null/);
  });

  it("assigns unclassified incomplete tracks to partial so health matches the dashboard invariant", () => {
    // Exact production bug: dashboard says 70 incomplete, but every classified
    // category counts 0. The invariant must surface those 70 as partial/pending.
    const invariant = enforceAudioFeatureIncompleteInvariant({
      activeTracks: 33645,
      complete: 33575,
      partial: 0,
      missing: 0,
      pending: 0,
      noData: 0,
      failed: 0,
      tooShort: 0,
    });

    assert.equal(invariant.audioIncomplete, 70);
    assert.equal(invariant.classifiedIncomplete, 0);
    assert.equal(invariant.unclassifiedIncomplete, 70);
    assert.equal(invariant.partial, 70);
    assert.equal(invariant.pending, 70);
  });

  it("keeps already-classified incomplete counts intact and never hides too-short tracks from pending", () => {
    const invariant = enforceAudioFeatureIncompleteInvariant({
      activeTracks: 10,
      complete: 8,
      partial: 2,
      missing: 0,
      pending: 2,
      noData: 0,
      failed: 0,
      tooShort: 0,
    });
    assert.equal(invariant.unclassifiedIncomplete, 0);
    assert.equal(invariant.partial, 2);
    assert.equal(invariant.pending, 2);

    const withTooShort = enforceAudioFeatureIncompleteInvariant({
      activeTracks: 10,
      complete: 8,
      partial: 0,
      missing: 0,
      pending: 0,
      noData: 0,
      failed: 0,
      tooShort: 1,
    });
    // 2 incomplete, 1 too short -> 1 unclassified becomes partial, pending excludes too short.
    assert.equal(withTooShort.partial, 1);
    assert.equal(withTooShort.pending, 1);
  });

  it("classifies two BPM-present incomplete tracks as partial and pending, not missing", () => {
    const completeFeature = {
      localEnergy: 0.7,
      localMood: 0.6,
      localDanceability: 0.5,
      localAcousticness: 0.4,
      tempo: 120,
      audioFeatureSource: "local_essentia",
      audioFeatureStatus: "success",
      energySource: "local_essentia",
      valenceSource: "local_essentia",
      danceabilitySource: "local_essentia",
      acousticnessSource: "local_essentia",
    };
    const tracks = Array.from({ length: 10 }, (_, index) => ({
      id: `track-${index + 1}`,
      syncStatus: "active",
      bpm: index >= 8 ? 124 : null,
      bpmSource: index >= 8 ? "Deezer" : null,
      mediaPath: index >= 8 ? "C:/Music/song.flac" : null,
      audioFeature: index < 8 ? completeFeature : {
        audioFeatureStatus: "partial",
        localEnergy: null,
        localMood: null,
        localDanceability: null,
        localAcousticness: null,
        tempo: null,
      },
    }));

    const classified = classifyAudioFeatureTracks(tracks, { api: false, local: true, preferLocalAudioFeatures: true });
    assert.equal(classified.counts.complete, 8);
    assert.equal(classified.counts.partial_audio_features, 2);
    assert.equal(classified.counts.missing_audio_features, 0);
    assert.equal(classified.counts.pending_audio_features, 2);
  });

  it("classifies two tracks with no BPM and no audio metadata as missing, not partial", () => {
    const completeFeature = {
      localEnergy: 0.7,
      localMood: 0.6,
      localDanceability: 0.5,
      localAcousticness: 0.4,
      tempo: 120,
      audioFeatureSource: "local_essentia",
      audioFeatureStatus: "success",
      energySource: "local_essentia",
      valenceSource: "local_essentia",
      danceabilitySource: "local_essentia",
      acousticnessSource: "local_essentia",
    };
    const tracks = Array.from({ length: 10 }, (_, index) => ({
      id: `track-${index + 1}`,
      syncStatus: "active",
      bpm: null,
      bpmSource: null,
      audioFeature: index < 8 ? completeFeature : null,
    }));

    const classified = classifyAudioFeatureTracks(tracks, { api: false, local: true, preferLocalAudioFeatures: true });
    assert.equal(classified.counts.complete, 8);
    assert.equal(classified.counts.missing_audio_features, 2);
    assert.equal(classified.counts.partial_audio_features, 0);
  });

  it("keeps tracks with no audio metadata at all classified as missing audio features", () => {
    const classified = classifyAudioFeatureTracks([{
      id: "track-missing",
      syncStatus: "active",
      bpm: null,
      bpmSource: null,
      audioFeature: null,
    }], {
      api: false,
      local: true,
      preferLocalAudioFeatures: true,
    });

    assert.equal(classified.counts.complete, 0);
    assert.equal(classified.counts.partial_audio_features, 0);
    assert.equal(classified.counts.missing_audio_features, 1);
    assert.equal(classified.counts.pending_audio_features, 1);
  });
});
