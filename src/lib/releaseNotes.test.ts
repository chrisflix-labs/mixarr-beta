import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  compareSemanticVersions,
  getReleaseNotesNewestFirst,
  getReleaseNotesOldestFirst,
  MIXARR_BETA_DISCORD_URL,
  releaseNotes,
} from "./releaseNotes";

describe("release notes", () => {
  it("sorts release notes from oldest to newest", () => {
    const ordered = getReleaseNotesOldestFirst();

    assert.deepEqual(ordered.map((note) => note.version), ["1.0.3", "1.0.4", "1.0.5", "1.1.0", "1.1.1", "1.1.2", "1.1.3", "1.1.4", "1.1.5", "1.1.6", "1.1.6-hotfix", "1.1.7", "1.1.8", "1.1.9", "1.1.9.1", "1.1.10", "1.2.0", "1.2.1", "1.2.2", "1.2.2-hotfix", "1.2.3", "1.2.4", "1.2.5", "1.2.6", "1.2.7", "1.2.8", "1.2.8-hotfix", "1.2.8-hotfix.2", "1.2.8-hotfix.3", "1.2.8-hotfix.4", "1.2.8-hotfix.5", "1.2.8-hotfix.6", "1.2.8-hotfix.7", "1.2.9", "1.2.9.1", "1.3.0", "1.3.0.1", "1.3.1", "1.3.2", "1.3.3", "1.3.4", "1.3.5"]);
  });

  it("sorts release notes from newest to oldest", () => {
    const ordered = getReleaseNotesNewestFirst();

    assert.deepEqual(ordered.map((note) => note.version), ["1.3.5", "1.3.4", "1.3.3", "1.3.2", "1.3.1", "1.3.0.1", "1.3.0", "1.2.9.1", "1.2.9", "1.2.8-hotfix.7", "1.2.8-hotfix.6", "1.2.8-hotfix.5", "1.2.8-hotfix.4", "1.2.8-hotfix.3", "1.2.8-hotfix.2", "1.2.8-hotfix", "1.2.8", "1.2.7", "1.2.6", "1.2.5", "1.2.4", "1.2.3", "1.2.2-hotfix", "1.2.2", "1.2.1", "1.2.0", "1.1.10", "1.1.9.1", "1.1.9", "1.1.8", "1.1.7", "1.1.6-hotfix", "1.1.6", "1.1.5", "1.1.4", "1.1.3", "1.1.2", "1.1.1", "1.1.0", "1.0.5", "1.0.4", "1.0.3"]);
  });

  it("sorts semantic versions newest first without string ordering", () => {
    const ordered = getReleaseNotesNewestFirst([
      { version: "v1.2.0", title: "One", badges: ["Beta"], changes: ["One"] },
      { version: "v1.10.0", title: "Two", badges: ["Beta"], changes: ["Two"] },
      { version: "v1.99.99", title: "Three", badges: ["Beta"], changes: ["Three"] },
      { version: "v2.0.0", title: "Four", badges: ["Beta"], changes: ["Four"] },
      { version: "v1.1.0", title: "Five", badges: ["Beta"], changes: ["Five"] },
      { version: "v1.1.1", title: "Six", badges: ["Beta"], changes: ["Six"] },
    ]);

    assert.deepEqual(ordered.map((note) => note.version), ["v2.0.0", "v1.99.99", "v1.10.0", "v1.2.0", "v1.1.1", "v1.1.0"]);
  });

  it("uses semantic version ordering", () => {
    assert.equal(compareSemanticVersions("1.0.10", "1.0.9") > 0, true);
    assert.equal(compareSemanticVersions("v1.0.9", "1.0.10") < 0, true);
    assert.equal(compareSemanticVersions("v1.10.0", "v1.2.0") > 0, true);
    assert.equal(compareSemanticVersions("v2.0.0", "v1.99.99") > 0, true);
    assert.equal(compareSemanticVersions("v1.1.1", "v1.1.0") > 0, true);
    assert.equal(compareSemanticVersions("v1.1.6-hotfix", "v1.1.6") > 0, true);
    assert.equal(compareSemanticVersions("v1.1.9.1", "v1.1.9") > 0, true);
    assert.equal(compareSemanticVersions("v1.1.10", "v1.1.9.1") > 0, true);
    assert.equal(compareSemanticVersions("v1.2.0", "v1.1.10") > 0, true);
    assert.equal(compareSemanticVersions("v1.2.1", "v1.2.0") > 0, true);
    assert.equal(compareSemanticVersions("v1.2.2", "v1.2.1") > 0, true);
    assert.equal(compareSemanticVersions("v1.2.2-hotfix", "v1.2.2") > 0, true);
    assert.equal(compareSemanticVersions("v1.2.3", "v1.2.2-hotfix") > 0, true);
    assert.equal(compareSemanticVersions("v1.2.2", "v1.2.2-rc") > 0, true);
    assert.equal(compareSemanticVersions("v1.2.2-rc", "v1.2.2-beta") > 0, true);
    assert.equal(compareSemanticVersions("v1.2.4", "v1.2.3") > 0, true);
    assert.equal(compareSemanticVersions("v1.2.5", "v1.2.4") > 0, true);
    assert.equal(compareSemanticVersions("v1.2.6", "v1.2.5") > 0, true);
    assert.equal(compareSemanticVersions("v1.2.7", "v1.2.6") > 0, true);
    assert.equal(compareSemanticVersions("v1.2.8", "v1.2.7") > 0, true);
    assert.equal(compareSemanticVersions("v1.2.8-hotfix", "v1.2.8") > 0, true);
    assert.equal(compareSemanticVersions("v1.2.8-hotfix.2", "v1.2.8-hotfix") > 0, true);
    assert.equal(compareSemanticVersions("v1.2.8-hotfix.3", "v1.2.8-hotfix.2") > 0, true);
    assert.equal(compareSemanticVersions("v1.2.8-hotfix.4", "v1.2.8-hotfix.3") > 0, true);
    assert.equal(compareSemanticVersions("v1.2.8-hotfix.5", "v1.2.8-hotfix.4") > 0, true);
    assert.equal(compareSemanticVersions("v1.2.8-hotfix.6", "v1.2.8-hotfix.5") > 0, true);
    assert.equal(compareSemanticVersions("v1.2.8-hotfix.10", "v1.2.8-hotfix.2") > 0, true);
    assert.equal(compareSemanticVersions("v1.2.9", "v1.2.8-hotfix.7") > 0, true);
    assert.equal(compareSemanticVersions("v1.2.9.1", "v1.2.9") > 0, true);
    assert.equal(compareSemanticVersions("v1.3.0", "v1.2.9.1") > 0, true);
    assert.equal(compareSemanticVersions("v1.3.0.1", "v1.3.0") > 0, true);
    assert.equal(compareSemanticVersions("v1.3.1", "v1.3.0.1") > 0, true);
    assert.equal(compareSemanticVersions("v1.3.2", "v1.3.1") > 0, true);
    assert.equal(compareSemanticVersions("v1.3.3", "v1.3.2") > 0, true);
    assert.equal(compareSemanticVersions("v1.3.4", "v1.3.3") > 0, true);
    assert.equal(compareSemanticVersions("v1.3.5", "v1.3.4") > 0, true);
    assert.equal(compareSemanticVersions("v1.2.10", "v1.2.9.1") > 0, true);
  });

  it("places v1.2.8 above v1.2.7 without string sorting", () => {
    const ordered = getReleaseNotesNewestFirst([
      { version: "v1.1.10", title: "One", badges: ["Beta"], changes: ["One"] },
      { version: "v1.2.0", title: "Two", badges: ["Beta"], changes: ["Two"] },
      { version: "v1.2.1", title: "Three", badges: ["Beta"], changes: ["Three"] },
      { version: "v1.2.2", title: "Four", badges: ["Beta"], changes: ["Four"] },
      { version: "v1.2.2-hotfix", title: "Five", badges: ["Beta"], changes: ["Five"] },
      { version: "v1.2.3", title: "Six", badges: ["Beta"], changes: ["Six"] },
      { version: "v1.2.4", title: "Seven", badges: ["Beta"], changes: ["Seven"] },
      { version: "v1.2.5", title: "Eight", badges: ["Beta"], changes: ["Eight"] },
      { version: "v1.2.6", title: "Nine", badges: ["Beta"], changes: ["Nine"] },
      { version: "v1.2.7", title: "Ten", badges: ["Beta"], changes: ["Ten"] },
      { version: "v1.2.8", title: "Eleven", badges: ["Beta"], changes: ["Eleven"] },
    ]);

    assert.deepEqual(ordered.map((note) => note.version), ["v1.2.8", "v1.2.7", "v1.2.6", "v1.2.5", "v1.2.4", "v1.2.3", "v1.2.2-hotfix", "v1.2.2", "v1.2.1", "v1.2.0", "v1.1.10"]);
  });

  it("places v1.2.2-hotfix above v1.2.2 and prior releases", () => {
    const ordered = getReleaseNotesNewestFirst([
      { version: "v1.2.2-hotfix", title: "Hotfix", badges: ["Beta"], changes: ["Hotfix"] },
      { version: "v1.1.9.1", title: "One", badges: ["Beta"], changes: ["One"] },
      { version: "v1.2.0", title: "Two", badges: ["Beta"], changes: ["Two"] },
      { version: "v1.1.10", title: "Three", badges: ["Beta"], changes: ["Three"] },
      { version: "v1.2.1", title: "Four", badges: ["Beta"], changes: ["Four"] },
      { version: "v1.2.2", title: "Five", badges: ["Beta"], changes: ["Five"] },
    ]);

    assert.deepEqual(ordered.map((note) => note.version), ["v1.2.2-hotfix", "v1.2.2", "v1.2.1", "v1.2.0", "v1.1.10", "v1.1.9.1"]);
  });

  it("keeps hotfix versions above matching final versions without string sorting", () => {
    const ordered = getReleaseNotesNewestFirst([
      { version: "v1.1.10", title: "One", badges: ["Beta"], changes: ["One"] },
      { version: "v1.2.0", title: "Two", badges: ["Beta"], changes: ["Two"] },
      { version: "v1.2.1", title: "Three", badges: ["Beta"], changes: ["Three"] },
      { version: "v1.2.2", title: "Four", badges: ["Beta"], changes: ["Four"] },
      { version: "v1.2.2-hotfix", title: "Five", badges: ["Beta"], changes: ["Five"] },
    ]);

    assert.deepEqual(ordered.map((note) => note.version), ["v1.2.2-hotfix", "v1.2.2", "v1.2.1", "v1.2.0", "v1.1.10"]);
  });

  it("places v1.2.8-hotfix above v1.2.8", () => {
    const ordered = getReleaseNotesNewestFirst([
      { version: "v1.2.8", title: "Final", badges: ["Beta"], changes: ["Final"] },
      { version: "v1.2.8-hotfix", title: "Hotfix", badges: ["Hotfix"], changes: ["Hotfix"] },
      { version: "v1.2.7", title: "Previous", badges: ["Beta"], changes: ["Previous"] },
    ]);

    assert.deepEqual(ordered.map((note) => note.version), ["v1.2.8-hotfix", "v1.2.8", "v1.2.7"]);
  });

  it("places v1.2.8-hotfix.2 above v1.2.8-hotfix", () => {
    const ordered = getReleaseNotesNewestFirst([
      { version: "v1.2.8", title: "Final", badges: ["Beta"], changes: ["Final"] },
      { version: "v1.2.8-hotfix", title: "Hotfix", badges: ["Hotfix"], changes: ["Hotfix"] },
      { version: "v1.2.8-hotfix.2", title: "Second hotfix", badges: ["Hotfix"], changes: ["Second hotfix"] },
    ]);

    assert.deepEqual(ordered.map((note) => note.version), ["v1.2.8-hotfix.2", "v1.2.8-hotfix", "v1.2.8"]);
  });

  it("places v1.2.8-hotfix.3 above v1.2.8-hotfix.2", () => {
    const ordered = getReleaseNotesNewestFirst([
      { version: "v1.2.8-hotfix.2", title: "Second hotfix", badges: ["Hotfix"], changes: ["Second hotfix"] },
      { version: "v1.2.8-hotfix.3", title: "Third hotfix", badges: ["Hotfix"], changes: ["Third hotfix"] },
      { version: "v1.2.8-hotfix", title: "Hotfix", badges: ["Hotfix"], changes: ["Hotfix"] },
    ]);

    assert.deepEqual(ordered.map((note) => note.version), ["v1.2.8-hotfix.3", "v1.2.8-hotfix.2", "v1.2.8-hotfix"]);
  });

  it("places v1.2.8-hotfix.6 above v1.2.8-hotfix.5", () => {
    const ordered = getReleaseNotesNewestFirst([
      { version: "v1.2.8-hotfix.2", title: "Second hotfix", badges: ["Hotfix"], changes: ["Second hotfix"] },
      { version: "v1.2.8-hotfix.5", title: "Fifth hotfix", badges: ["Hotfix"], changes: ["Fifth hotfix"] },
      { version: "v1.2.8-hotfix.6", title: "Sixth hotfix", badges: ["Hotfix"], changes: ["Sixth hotfix"] },
      { version: "v1.2.8-hotfix.4", title: "Fourth hotfix", badges: ["Hotfix"], changes: ["Fourth hotfix"] },
      { version: "v1.2.8-hotfix.3", title: "Third hotfix", badges: ["Hotfix"], changes: ["Third hotfix"] },
    ]);

    assert.deepEqual(ordered.map((note) => note.version), ["v1.2.8-hotfix.6", "v1.2.8-hotfix.5", "v1.2.8-hotfix.4", "v1.2.8-hotfix.3", "v1.2.8-hotfix.2"]);
  });

  it("keeps the beta Discord invite exact", () => {
    assert.equal(MIXARR_BETA_DISCORD_URL, "https://discord.com/invite/B7xMvAhaF");
  });

  it("includes changes for each seeded version", () => {
    assert.equal(releaseNotes.every((note) => note.title && note.changes.length > 0), true);
  });

  it("places v1.2.8-hotfix.7 above v1.2.8-hotfix.6", () => {
    const ordered = getReleaseNotesNewestFirst([
      { version: "v1.2.8-hotfix.5", title: "Fifth hotfix", badges: ["Hotfix"], changes: ["Fifth hotfix"] },
      { version: "v1.2.8-hotfix.7", title: "Seventh hotfix", badges: ["Hotfix"], changes: ["Seventh hotfix"] },
      { version: "v1.2.8-hotfix.6", title: "Sixth hotfix", badges: ["Hotfix"], changes: ["Sixth hotfix"] },
    ]);

    assert.deepEqual(ordered.map((note) => note.version), ["v1.2.8-hotfix.7", "v1.2.8-hotfix.6", "v1.2.8-hotfix.5"]);
  });

  it("places v1.2.9 above v1.2.8-hotfix.7", () => {
    const ordered = getReleaseNotesNewestFirst([
      { version: "v1.2.8", title: "Final", badges: ["Beta"], changes: ["Final"] },
      { version: "v1.2.8-hotfix.6", title: "Sixth hotfix", badges: ["Hotfix"], changes: ["Sixth hotfix"] },
      { version: "v1.2.8-hotfix.7", title: "Seventh hotfix", badges: ["Hotfix"], changes: ["Seventh hotfix"] },
      { version: "v1.2.9", title: "Playlist Builder UI Fix", badges: ["UI"], changes: ["Fix"] },
      { version: "v1.2.7", title: "Previous", badges: ["Beta"], changes: ["Previous"] },
    ]);

    assert.deepEqual(ordered.map((note) => note.version), ["v1.2.9", "v1.2.8-hotfix.7", "v1.2.8-hotfix.6", "v1.2.8", "v1.2.7"]);
  });

  it("places v1.2.10 above v1.2.9.1 and v1.2.9.1 above v1.2.9", () => {
    const ordered = getReleaseNotesNewestFirst([
      { version: "v1.2.9", title: "Playlist Builder UI Fix", badges: ["UI"], changes: ["Fix"] },
      { version: "v1.2.10", title: "Later", badges: ["Beta"], changes: ["Later"] },
      { version: "v1.2.9.1", title: "Matching Rules Layout Fix", badges: ["Hotfix"], changes: ["Hotfix"] },
    ]);

    assert.deepEqual(ordered.map((note) => note.version), ["v1.2.10", "v1.2.9.1", "v1.2.9"]);
  });

  it("places v1.3.0 above v1.2.9.1 and prior releases", () => {
    const ordered = getReleaseNotesNewestFirst([
      { version: "v1.2.8", title: "Final", badges: ["Beta"], changes: ["Final"] },
      { version: "v1.2.8-hotfix.7", title: "Hotfix", badges: ["Hotfix"], changes: ["Hotfix"] },
      { version: "v1.2.9", title: "Playlist Builder UI Fix", badges: ["UI"], changes: ["Fix"] },
      { version: "v1.2.9.1", title: "Matching Rules Layout Fix", badges: ["Hotfix"], changes: ["Hotfix"] },
      { version: "v1.3.0", title: "Library Health Accuracy", badges: ["Library Health"], changes: ["Accuracy"] },
    ]);

    assert.deepEqual(ordered.map((note) => note.version), ["v1.3.0", "v1.2.9.1", "v1.2.9", "v1.2.8-hotfix.7", "v1.2.8"]);
  });

  it("places v1.3.0.1 above v1.3.0 while keeping v1.3.1 newer", () => {
    const ordered = getReleaseNotesNewestFirst([
      { version: "v1.3.0", title: "Library Health Accuracy", badges: ["Library Health"], changes: ["Accuracy"] },
      { version: "v1.3.0.1", title: "Audio Features Health Card Sync Fix", badges: ["Hotfix"], changes: ["Fix"] },
      { version: "v1.3.1", title: "Later", badges: ["Beta"], changes: ["Later"] },
    ]);

    assert.deepEqual(ordered.map((note) => note.version), ["v1.3.1", "v1.3.0.1", "v1.3.0"]);
  });

  it("places v1.3.2 above v1.3.1", () => {
    const ordered = getReleaseNotesNewestFirst([
      { version: "v1.3.0", title: "Library Health Accuracy", badges: ["Library Health"], changes: ["Accuracy"] },
      { version: "v1.3.1", title: "Audio Feature Retry Improvements", badges: ["Audio Features"], changes: ["Retry"] },
      { version: "v1.3.2", title: "Local Audio Analysis Polish", badges: ["Local Analysis"], changes: ["Polish"] },
    ]);

    assert.deepEqual(ordered.map((note) => note.version), ["v1.3.2", "v1.3.1", "v1.3.0"]);
  });

  it("places v1.3.3 above v1.3.2", () => {
    const ordered = getReleaseNotesNewestFirst([
      { version: "v1.3.1", title: "Audio Feature Retry Improvements", badges: ["Audio Features"], changes: ["Retry"] },
      { version: "v1.3.2", title: "Local Audio Analysis Polish", badges: ["Local Analysis"], changes: ["Polish"] },
      { version: "v1.3.3", title: "Data Enrichment Cleanup", badges: ["Data Enrichment"], changes: ["Cleanup"] },
    ]);

    assert.deepEqual(ordered.map((note) => note.version), ["v1.3.3", "v1.3.2", "v1.3.1"]);
  });

  it("places v1.3.4 above v1.3.3", () => {
    const ordered = getReleaseNotesNewestFirst([
      { version: "v1.3.2", title: "Local Audio Analysis Polish", badges: ["Local Analysis"], changes: ["Polish"] },
      { version: "v1.3.3", title: "Data Enrichment Cleanup", badges: ["Data Enrichment"], changes: ["Cleanup"] },
      { version: "v1.3.4", title: "BPM Confidence & Source Improvements", badges: ["BPM"], changes: ["Confidence"] },
    ]);

    assert.deepEqual(ordered.map((note) => note.version), ["v1.3.4", "v1.3.3", "v1.3.2"]);
  });

  it("places v1.3.5 above v1.3.4", () => {
    const ordered = getReleaseNotesNewestFirst([
      { version: "v1.3.3", title: "Data Enrichment Cleanup", badges: ["Data Enrichment"], changes: ["Cleanup"] },
      { version: "v1.3.4", title: "BPM Confidence & Source Improvements", badges: ["BPM"], changes: ["Confidence"] },
      { version: "v1.3.5", title: "Mood & Energy Sync Improvements", badges: ["Mood", "Energy"], changes: ["Mood"] },
    ]);

    assert.deepEqual(ordered.map((note) => note.version), ["v1.3.5", "v1.3.4", "v1.3.3"]);
  });

  it("adds the v1.3.5 release note at the top", () => {
    const [latest] = getReleaseNotesNewestFirst();

    assert.equal(latest.version, "1.3.5");
    assert.equal(latest.title, "Mood & Energy Sync Improvements");
    assert.deepEqual(latest.badges, ["Mood", "Energy", "Audio Features", "Library Health", "Data Enrichment", "Smart Builder"]);
  });

  it("links the sidebar navigation to the release notes page", () => {
    const sidebarPath = join(process.cwd(), "src", "components", "Sidebar.tsx");
    const sidebar = readFileSync(sidebarPath, "utf8");

    assert.match(sidebar, /href: "\/release-notes"/);
    assert.match(sidebar, /Release Notes/);
  });

  it("links the sidebar navigation to the roadmap page", () => {
    const sidebarPath = join(process.cwd(), "src", "components", "Sidebar.tsx");
    const sidebar = readFileSync(sidebarPath, "utf8");

    assert.match(sidebar, /href: "\/roadmap"/);
    assert.match(sidebar, /Roadmap/);
  });

  it("links the sidebar navigation to the job history page", () => {
    const sidebarPath = join(process.cwd(), "src", "components", "Sidebar.tsx");
    const sidebar = readFileSync(sidebarPath, "utf8");

    assert.match(sidebar, /href: "\/job-history"/);
    assert.match(sidebar, /Job History/);
  });

  it("links the sidebar navigation to the playlist history page", () => {
    const sidebarPath = join(process.cwd(), "src", "components", "Sidebar.tsx");
    const sidebar = readFileSync(sidebarPath, "utf8");

    assert.match(sidebar, /href: "\/playlist-history"/);
    assert.match(sidebar, /Playlist History/);
  });
});
