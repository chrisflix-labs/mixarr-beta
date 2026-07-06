"use client";

import { bpmPresets, type BpmPreset } from "@/lib/bpmPresets";

type BpmPresetPickerClasses = {
  section: string;
  header: string;
  grid: string;
  card: string;
  activeCard: string;
  badgeRow: string;
  footer: string;
  clearButton: string;
};

type BpmPresetPickerProps = {
  selectedLabel: string;
  selectedPresetId?: string;
  selectedPreset?: BpmPreset | null;
  onSelect: (preset: BpmPreset) => void;
  onClear: () => void;
  classes: BpmPresetPickerClasses;
};

export default function BpmPresetPicker({
  selectedLabel,
  selectedPresetId,
  selectedPreset,
  onSelect,
  onClear,
  classes,
}: BpmPresetPickerProps) {
  return (
    <section className={classes.section} aria-labelledby="bpm-presets-picker">
      <div className={classes.header}>
        <div>
          <h4 id="bpm-presets-picker">Choose a tempo</h4>
          <p>Tune your smart playlist with quick BPM range presets.</p>
        </div>
        <span>BPM preset: <strong>{selectedLabel}</strong></span>
      </div>
      <div className={classes.grid}>
        {bpmPresets.map((preset) => (
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
        {!selectedPresetId && <p>Manual BPM fields are active.</p>}
      </div>
    </section>
  );
}
