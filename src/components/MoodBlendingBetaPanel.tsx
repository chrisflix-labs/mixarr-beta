"use client";

import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { AlertTriangle, ArrowDown, ArrowUp, Plus, Sparkles, X } from "lucide-react";
import styles from "./MoodBlendingBetaPanel.module.css";

export type MoodBlendMode = "off" | "smooth_transition" | "strict_matching" | "mixed_mood";

export type MoodBlendBetaSettings = {
  moodBlendMode: MoodBlendMode;
  selectedMoodPath: string[];
  allowedMoods: string[];
  moodStrength: number;
  transitionSmoothness: number;
  moodStrictness: number;
  fallbackTolerance: number;
  bridgeTrackPreference: number;
  moodVariety: number;
  conflictSensitivity: number;
  selectedMoodPreset: string;
};

type MoodOption = {
  name: string;
  count: number;
};

type Props = {
  settings: MoodBlendBetaSettings;
  onChange: (patch: Partial<MoodBlendBetaSettings>) => void;
  serverId?: string;
  libraryId?: string;
  disabled?: boolean;
};

export const DEFAULT_MOOD_BLEND_BETA_SETTINGS: MoodBlendBetaSettings = {
  moodBlendMode: "off",
  selectedMoodPath: [],
  allowedMoods: [],
  moodStrength: 65,
  transitionSmoothness: 70,
  moodStrictness: 60,
  fallbackTolerance: 35,
  bridgeTrackPreference: 60,
  moodVariety: 45,
  conflictSensitivity: 70,
  selectedMoodPreset: "balanced_flow",
};

const modeCards: Array<{ mode: MoodBlendMode; title: string; description: string }> = [
  { mode: "off", title: "Off", description: "Smart Mix will not apply mood blending." },
  { mode: "smooth_transition", title: "Smooth Transition", description: "Build a playlist journey from one mood to the next." },
  { mode: "strict_matching", title: "Strict Matching", description: "Stay close to selected moods and avoid unrelated tracks." },
  { mode: "mixed_mood", title: "Mixed Mood", description: "Allow compatible moods to appear naturally." },
];

const moodBlendPresets: Array<{
  id: string;
  name: string;
  mode: MoodBlendMode;
  moods: string[];
  values: Pick<MoodBlendBetaSettings, "moodStrength" | "transitionSmoothness" | "moodStrictness" | "fallbackTolerance" | "bridgeTrackPreference" | "moodVariety" | "conflictSensitivity">;
}> = [
  {
    id: "balanced_flow",
    name: "Balanced Flow",
    mode: "smooth_transition",
    moods: [],
    values: { moodStrength: 65, transitionSmoothness: 70, moodStrictness: 60, fallbackTolerance: 35, bridgeTrackPreference: 60, moodVariety: 45, conflictSensitivity: 70 },
  },
  {
    id: "smooth_journey",
    name: "Smooth Journey",
    mode: "smooth_transition",
    moods: [],
    values: { moodStrength: 70, transitionSmoothness: 88, moodStrictness: 62, fallbackTolerance: 32, bridgeTrackPreference: 78, moodVariety: 40, conflictSensitivity: 72 },
  },
  {
    id: "strict_mood_lock",
    name: "Strict Mood Lock",
    mode: "strict_matching",
    moods: [],
    values: { moodStrength: 90, transitionSmoothness: 50, moodStrictness: 90, fallbackTolerance: 15, bridgeTrackPreference: 40, moodVariety: 25, conflictSensitivity: 85 },
  },
  {
    id: "mixed_discovery",
    name: "Mixed Discovery",
    mode: "mixed_mood",
    moods: [],
    values: { moodStrength: 55, transitionSmoothness: 45, moodStrictness: 40, fallbackTolerance: 50, bridgeTrackPreference: 70, moodVariety: 75, conflictSensitivity: 50 },
  },
  {
    id: "chill_blend",
    name: "Chill Blend",
    mode: "mixed_mood",
    moods: ["chill", "focus", "ambient"],
    values: { moodStrength: 62, transitionSmoothness: 72, moodStrictness: 48, fallbackTolerance: 42, bridgeTrackPreference: 68, moodVariety: 58, conflictSensitivity: 55 },
  },
  {
    id: "high_energy_ramp",
    name: "High Energy Ramp",
    mode: "smooth_transition",
    moods: ["happy", "energetic", "party"],
    values: { moodStrength: 78, transitionSmoothness: 76, moodStrictness: 68, fallbackTolerance: 28, bridgeTrackPreference: 70, moodVariety: 38, conflictSensitivity: 74 },
  },
  {
    id: "dark_progression",
    name: "Dark Progression",
    mode: "smooth_transition",
    moods: ["dark", "moody", "intense"],
    values: { moodStrength: 74, transitionSmoothness: 74, moodStrictness: 70, fallbackTolerance: 30, bridgeTrackPreference: 64, moodVariety: 35, conflictSensitivity: 78 },
  },
  {
    id: "dj_friendly_flow",
    name: "DJ Friendly Flow",
    mode: "smooth_transition",
    moods: [],
    values: { moodStrength: 68, transitionSmoothness: 82, moodStrictness: 55, fallbackTolerance: 38, bridgeTrackPreference: 86, moodVariety: 52, conflictSensitivity: 62 },
  },
];

const suggestedGroups = [
  { label: "Happy Ramp", moods: ["happy", "energetic", "party"] },
  { label: "Deep Work", moods: ["chill", "focus", "ambient"] },
  { label: "Dark Build", moods: ["dark", "moody", "intense"] },
  { label: "Discovery Blend", moods: ["chill", "happy", "energetic"] },
];

const sliderDescriptions: Record<keyof Pick<MoodBlendBetaSettings, "moodStrength" | "transitionSmoothness" | "moodStrictness" | "fallbackTolerance" | "bridgeTrackPreference" | "moodVariety" | "conflictSensitivity">, { label: string; help: string; low: string; high: string }> = {
  moodStrength: { label: "Mood Strength", help: "Controls how strongly mood tags influence selection.", low: "Loose", high: "Strong" },
  transitionSmoothness: { label: "Transition Smoothness", help: "Higher values prefer gradual movement through the mood flow.", low: "Quick", high: "Smooth" },
  moodStrictness: { label: "Strictness", help: "Controls how heavily unrelated moods are penalized.", low: "Open", high: "Locked" },
  fallbackTolerance: { label: "Fallback Tolerance", help: "Higher values allow more weak or missing mood metadata.", low: "Few", high: "More" },
  bridgeTrackPreference: { label: "Bridge Track Preference", help: "Rewards tracks that connect adjacent moods.", low: "Low", high: "High" },
  moodVariety: { label: "Mood Variety", help: "Allows secondary moods to appear when they still fit.", low: "Focused", high: "Varied" },
  conflictSensitivity: { label: "Conflict Sensitivity", help: "Raises penalties and warnings for harsh mood jumps.", low: "Calm", high: "Alert" },
};

function titleCase(value: string) {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function dedupeMoods(moods: string[]) {
  const seen = new Set<string>();
  return moods
    .map((mood) => mood.trim())
    .filter(Boolean)
    .filter((mood) => {
      const key = mood.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

function activeMoodsFor(settings: MoodBlendBetaSettings) {
  return settings.moodBlendMode === "mixed_mood" ? settings.allowedMoods : settings.selectedMoodPath;
}

function curvePreview(settings: MoodBlendBetaSettings) {
  const moods = activeMoodsFor(settings);
  if (settings.moodBlendMode === "off") return ["Mood blending is off."];
  if (settings.moodBlendMode === "mixed_mood") return moods.length ? [`Allowed mood pool: ${moods.map(titleCase).join(", ")}`] : ["Choose at least two allowed moods."];
  if (settings.moodBlendMode === "strict_matching") return moods.length ? [`Target moods: ${moods.map(titleCase).join(", ")}`, "Smart Mix will strongly prefer tracks matching these moods."] : ["Choose target moods for the lock."];
  if (moods.length === 0) return ["Choose moods to preview the journey."];
  if (moods.length === 1) return [`Start ${titleCase(moods[0])} End`];
  const blended = moods.flatMap((mood, index) => index < moods.length - 1 ? [mood, `${mood}/${moods[index + 1]}`] : [mood]);
  return [`Start ${blended.map(titleCase).join(" -> ")} End`];
}

export default function MoodBlendingBetaPanel({ settings, onChange, serverId, libraryId, disabled = false }: Props) {
  const [moodOptions, setMoodOptions] = useState<MoodOption[]>([]);
  const [activeTrackCount, setActiveTrackCount] = useState(0);
  const [missingMoodTrackCount, setMissingMoodTrackCount] = useState(0);
  const [loadingMoods, setLoadingMoods] = useState(false);
  const [moodQuery, setMoodQuery] = useState("");
  const [selectedAddMood, setSelectedAddMood] = useState("");

  useEffect(() => {
    let cancelled = false;
    const loadMoods = async () => {
      setLoadingMoods(true);
      try {
        const params = new URLSearchParams();
        if (serverId) params.set("serverId", serverId);
        if (libraryId) params.set("libraryId", libraryId);
        const response = await axios.get(`/api/mood-tags${params.toString() ? `?${params.toString()}` : ""}`);
        if (!cancelled) {
          setMoodOptions(response.data.moods || []);
          setActiveTrackCount(Number(response.data.activeTrackCount) || 0);
          setMissingMoodTrackCount(Number(response.data.missingMoodTrackCount) || 0);
        }
      } catch (error) {
        console.error("Failed to load mood tags", error);
        if (!cancelled) {
          setMoodOptions([]);
          setActiveTrackCount(0);
          setMissingMoodTrackCount(0);
        }
      } finally {
        if (!cancelled) setLoadingMoods(false);
      }
    };
    loadMoods();
    return () => {
      cancelled = true;
    };
  }, [serverId, libraryId]);

  const enabled = settings.moodBlendMode !== "off" && !disabled;
  const canPickMoods = enabled && moodOptions.length > 0;
  const activeMoods = activeMoodsFor(settings);
  const selectedKeys = new Set(activeMoods.map((mood) => mood.toLowerCase()));
  const filteredMoodOptions = moodOptions
    .filter((mood) => !selectedKeys.has(mood.name.toLowerCase()))
    .filter((mood) => !moodQuery.trim() || mood.name.toLowerCase().includes(moodQuery.trim().toLowerCase()))
    .slice(0, 12);
  const moodCounts = useMemo(() => new Map(moodOptions.map((mood) => [mood.name.toLowerCase(), mood.count])), [moodOptions]);
  const availableSuggestedGroups = suggestedGroups
    .map((group) => ({ ...group, moods: group.moods.filter((mood) => moodCounts.has(mood.toLowerCase())) }))
    .filter((group) => group.moods.length > 0);
  const missingMoodPercent = activeTrackCount > 0 ? Math.round(missingMoodTrackCount / activeTrackCount * 100) : 0;
  const zeroCoverageMood = activeMoods.find((mood) => (moodCounts.get(mood.toLowerCase()) || 0) === 0);
  const warnings = [
    ...(enabled && settings.moodBlendMode === "smooth_transition" && activeMoods.length < 2 ? ["Smooth Transition works best with at least 2 moods selected."] : []),
    ...(enabled && settings.moodBlendMode === "mixed_mood" && activeMoods.length < 2 ? ["Mixed Mood works best with at least 2 allowed moods."] : []),
    ...(enabled && zeroCoverageMood ? [`${titleCase(zeroCoverageMood)} is not represented in this library yet. Choose a nearby mood or increase Fallback Tolerance.`] : []),
    ...(enabled && activeMoods.some((mood) => (moodCounts.get(mood.toLowerCase()) || 0) > 0 && (moodCounts.get(mood.toLowerCase()) || 0) < 15)
      ? [`${titleCase(activeMoods.find((mood) => (moodCounts.get(mood.toLowerCase()) || 0) > 0 && (moodCounts.get(mood.toLowerCase()) || 0) < 15) || "A selected mood")} has low coverage. Consider lowering Strictness or increasing Fallback Tolerance.`]
      : []),
    ...(enabled && settings.moodStrictness > 80 && settings.fallbackTolerance < 25 ? ["Strictness is high and fallback tolerance is low, so the playlist may feel narrow."] : []),
    ...(enabled && settings.moodStrength > 80 && missingMoodPercent > 30 ? ["Mood Strength is high, but many candidate tracks may be missing mood tags."] : []),
  ];

  const applyMode = (mode: MoodBlendMode) => {
    const defaults = mode === "strict_matching" ? { moodStrictness: 85 } : mode === "mixed_mood" ? { moodStrictness: 50 } : { moodStrictness: 60 };
    onChange({ moodBlendMode: mode, ...defaults });
  };

  const addMood = (mood: string) => {
    const next = dedupeMoods([...activeMoods, mood]);
    onChange(settings.moodBlendMode === "mixed_mood" ? { allowedMoods: next } : { selectedMoodPath: next });
    setMoodQuery("");
    setSelectedAddMood("");
  };

  const removeMood = (index: number) => {
    const next = activeMoods.filter((_, moodIndex) => moodIndex !== index);
    onChange(settings.moodBlendMode === "mixed_mood" ? { allowedMoods: next } : { selectedMoodPath: next });
  };

  const moveMood = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= activeMoods.length) return;
    const next = [...activeMoods];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    onChange(settings.moodBlendMode === "mixed_mood" ? { allowedMoods: next } : { selectedMoodPath: next });
  };

  const clearMoods = () => {
    onChange(settings.moodBlendMode === "mixed_mood" ? { allowedMoods: [] } : { selectedMoodPath: [] });
  };

  const applyPreset = (presetId: string) => {
    const preset = moodBlendPresets.find((item) => item.id === presetId);
    if (!preset) return;
    const moodPatch = preset.mode === "mixed_mood"
      ? { allowedMoods: preset.moods.length ? preset.moods : settings.allowedMoods }
      : { selectedMoodPath: preset.moods.length ? preset.moods : settings.selectedMoodPath };
    onChange({
      moodBlendMode: preset.mode,
      selectedMoodPreset: preset.id,
      ...preset.values,
      ...moodPatch,
    });
  };

  const updateSlider = (key: keyof Pick<MoodBlendBetaSettings, "moodStrength" | "transitionSmoothness" | "moodStrictness" | "fallbackTolerance" | "bridgeTrackPreference" | "moodVariety" | "conflictSensitivity">, value: number) => {
    onChange({ [key]: value, selectedMoodPreset: "custom" } as Partial<MoodBlendBetaSettings>);
  };

  return (
    <section className={styles.panel} aria-label="Mood Blending Beta">
      <div className={styles.header}>
        <div>
          <div className={styles.titleRow}>
            <Sparkles size={17} />
            <h3>Mood Blending Beta</h3>
            <span className={styles.betaBadge}>Beta</span>
          </div>
          <p className={styles.subtitle}>Shape how Smart Mix moves between moods, bridges transitions, and handles fallback tracks.</p>
        </div>
        <span className={styles.statusPill}>{modeCards.find((mode) => mode.mode === settings.moodBlendMode)?.title || "Off"}</span>
      </div>

      <div className={styles.modeGrid}>
        {modeCards.map((mode) => (
          <button
            key={mode.mode}
            type="button"
            className={`${styles.modeCard} ${settings.moodBlendMode === mode.mode ? styles.activeMode : ""}`}
            onClick={() => applyMode(mode.mode)}
            disabled={disabled}
          >
            <strong>{mode.title}</strong>
            <span>{mode.description}</span>
          </button>
        ))}
      </div>

      <div className={`${styles.section} ${!enabled ? styles.disabledSection : ""}`}>
        <div className={styles.sectionHeader}>
          <div>
            <h4>{settings.moodBlendMode === "mixed_mood" ? "Allowed Moods" : "Mood Flow"}</h4>
            <p className={styles.helper}>Choose how the playlist should move from one mood to the next.</p>
          </div>
          <button type="button" className={styles.secondaryButton} onClick={clearMoods} disabled={!enabled || activeMoods.length === 0}>Clear</button>
        </div>

        {moodOptions.length === 0 && !loadingMoods ? (
          <p className={styles.emptyState}>Run mood enrichment to unlock selectable mood blending.</p>
        ) : (
          <div className={styles.pickerRow}>
            <label className={styles.field}>
              Search moods
              <input
                className={styles.input}
                value={moodQuery}
                onChange={(event) => setMoodQuery(event.target.value)}
                placeholder="Search mood tags"
                disabled={!canPickMoods}
              />
            </label>
            <label className={styles.field}>
              Add mood
              <select className={styles.select} value={selectedAddMood} onChange={(event) => setSelectedAddMood(event.target.value)} disabled={!canPickMoods}>
                <option value="">{loadingMoods ? "Loading..." : "Choose mood"}</option>
                {filteredMoodOptions.map((mood) => (
                  <option key={mood.name} value={mood.name}>{titleCase(mood.name)} ({mood.count})</option>
                ))}
              </select>
            </label>
            <button type="button" className={styles.secondaryButton} onClick={() => selectedAddMood && addMood(selectedAddMood)} disabled={!canPickMoods || !selectedAddMood}>
              <Plus size={14} /> Add
            </button>
          </div>
        )}

        {filteredMoodOptions.length > 0 && canPickMoods && (
          <div className={styles.chipRow}>
            {filteredMoodOptions.slice(0, 8).map((mood) => (
              <button key={mood.name} type="button" className={styles.chip} onClick={() => addMood(mood.name)}>
                <span>{titleCase(mood.name)}</span>
                <small>{mood.count}</small>
              </button>
            ))}
          </div>
        )}

        <div className={styles.flowRow}>
          {activeMoods.length === 0 ? (
            <p className={styles.emptyState}>No moods selected yet.</p>
          ) : activeMoods.map((mood, index) => (
            <span key={`${mood}-${index}`} className={styles.flowChip}>
              <span>{titleCase(mood)}</span>
              <button type="button" onClick={() => moveMood(index, -1)} disabled={index === 0 || !enabled} aria-label={`Move ${mood} earlier`}><ArrowUp size={12} /></button>
              <button type="button" onClick={() => moveMood(index, 1)} disabled={index === activeMoods.length - 1 || !enabled} aria-label={`Move ${mood} later`}><ArrowDown size={12} /></button>
              <button type="button" onClick={() => removeMood(index)} disabled={!enabled} aria-label={`Remove ${mood}`}><X size={12} /></button>
            </span>
          ))}
        </div>

        <div className={styles.suggestionGroups}>
          {availableSuggestedGroups.map((group) => (
            <button key={group.label} type="button" onClick={() => onChange(settings.moodBlendMode === "mixed_mood" ? { allowedMoods: group.moods } : { selectedMoodPath: group.moods })} disabled={!canPickMoods}>
              {group.label}
            </button>
          ))}
        </div>
      </div>

      {settings.moodBlendMode !== "off" && (
        <>
          <div className={styles.section}>
            <div className={styles.sectionHeader}>
              <div>
                <h4>Presets</h4>
                <p className={styles.helper}>Start with a beta recipe, then tune the sliders.</p>
              </div>
            </div>
            <div className={styles.presetGrid}>
              {moodBlendPresets.map((preset) => (
                <button key={preset.id} type="button" className={`${styles.presetButton} ${settings.selectedMoodPreset === preset.id ? styles.activePreset : ""}`} onClick={() => applyPreset(preset.id)}>
                  <strong>{preset.name}</strong>
                  <span>{modeCards.find((mode) => mode.mode === preset.mode)?.title}</span>
                </button>
              ))}
            </div>
          </div>

          <div className={styles.section}>
            <div className={styles.sliderGrid}>
              {(["moodStrength", "transitionSmoothness", "moodStrictness", "fallbackTolerance"] as const).map((key) => (
                <Slider key={key} name={key} value={settings[key]} onChange={updateSlider} />
              ))}
            </div>
            <details>
              <summary className={styles.advancedSummary}>Advanced Beta Controls</summary>
              <div className={`${styles.sliderGrid} ${styles.advancedBody}`}>
                {(["bridgeTrackPreference", "moodVariety", "conflictSensitivity"] as const).map((key) => (
                  <Slider key={key} name={key} value={settings[key]} onChange={updateSlider} />
                ))}
              </div>
            </details>
          </div>

          <div className={styles.previewGrid}>
            <div className={styles.innerCard}>
              <strong>Mood Coverage</strong>
              <div className={styles.coverageList}>
                {activeMoods.length === 0 ? <p className={styles.helper}>Select moods to see coverage.</p> : activeMoods.map((mood) => (
                  <div key={mood} className={styles.coverageItem}>
                    <strong>{titleCase(mood)}</strong>
                    <span>{(moodCounts.get(mood.toLowerCase()) || 0).toLocaleString()} tracks</span>
                  </div>
                ))}
                {activeTrackCount > 0 && (
                  <div className={styles.coverageItem}>
                    <strong>Missing mood tags</strong>
                    <span>{missingMoodPercent}%</span>
                  </div>
                )}
              </div>
            </div>
            <div className={styles.innerCard}>
              <strong>{settings.moodBlendMode === "strict_matching" ? "Mood Lock Preview" : settings.moodBlendMode === "mixed_mood" ? "Mixed Mood Preview" : "Mood Curve Preview"}</strong>
              <div className={styles.curveRow}>
                {curvePreview(settings).map((line) => <span key={line} className={styles.curveChip}>{line}</span>)}
              </div>
            </div>
          </div>

          {warnings.length > 0 && (
            <div className={styles.warningList}>
              <div className={styles.warningTitle}><AlertTriangle size={15} /> Mood Warnings</div>
              {warnings.map((warning) => <p key={warning}>{warning}</p>)}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Slider({
  name,
  value,
  onChange,
}: {
  name: keyof Pick<MoodBlendBetaSettings, "moodStrength" | "transitionSmoothness" | "moodStrictness" | "fallbackTolerance" | "bridgeTrackPreference" | "moodVariety" | "conflictSensitivity">;
  value: number;
  onChange: (name: keyof Pick<MoodBlendBetaSettings, "moodStrength" | "transitionSmoothness" | "moodStrictness" | "fallbackTolerance" | "bridgeTrackPreference" | "moodVariety" | "conflictSensitivity">, value: number) => void;
}) {
  const meta = sliderDescriptions[name];
  return (
    <label className={styles.sliderControl}>
      <span className={styles.sliderTop}>
        <span>{meta.label}</span>
        <strong>{value}</strong>
      </span>
      <input type="range" min="0" max="100" value={value} onChange={(event) => onChange(name, Number(event.target.value))} />
      <span className={styles.sliderScale}>
        <span>{meta.low}</span>
        <span>{meta.high}</span>
      </span>
      <small>{meta.help}</small>
    </label>
  );
}
