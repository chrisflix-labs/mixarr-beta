"use client";

import { moodPresets, type MoodPreset } from "@/lib/moodPresets";

type MoodPresetPickerClasses = {
  section: string;
  header: string;
  grid: string;
  card: string;
  activeCard: string;
  badgeRow: string;
  footer: string;
  clearButton: string;
};

type MoodPresetPickerProps = {
  title?: string;
  description?: string;
  selectedLabel: string;
  selectedPresetId?: string;
  selectedPreset?: MoodPreset | null;
  onSelect: (preset: MoodPreset) => void;
  onClear: () => void;
  classes: MoodPresetPickerClasses;
};

export default function MoodPresetPicker({
  title = "Choose a mood",
  description = "Tune this smart playlist with mood, energy, and BPM presets.",
  selectedLabel,
  selectedPresetId,
  selectedPreset,
  onSelect,
  onClear,
  classes,
}: MoodPresetPickerProps) {
  return (
    <section className={classes.section} aria-labelledby="mood-presets-picker">
      <div className={classes.header}>
        <div>
          <h4 id="mood-presets-picker">{title}</h4>
          <p>{description}</p>
        </div>
        <span>Mood preset: <strong>{selectedLabel}</strong></span>
      </div>
      <div className={classes.grid}>
        {moodPresets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => onSelect(preset)}
            className={`${classes.card} ${selectedPresetId === preset.id ? classes.activeCard : ""}`}
          >
            <span>{preset.name}</span>
            <small>{preset.description}</small>
            <span className={classes.badgeRow}>
              {(preset.badges || []).map((badge) => <b key={badge}>{badge}</b>)}
            </span>
          </button>
        ))}
      </div>
      <div className={classes.footer}>
        {selectedPreset && <p>{selectedPreset.explanation}</p>}
        {selectedPresetId && (
          <button type="button" onClick={onClear} className={classes.clearButton}>
            Clear preset
          </button>
        )}
      </div>
    </section>
  );
}
