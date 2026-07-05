import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSchedulerSettingsFromInput,
  DEFAULT_SCHEDULER_CRON,
  generateSchedulerCron,
  resolveSchedulerSettingsFromStoredValue,
  SchedulerSettingsValidationError,
} from "./schedulerSettingsCore";

describe("scheduler settings", () => {
  it("defaults to 3:00 AM daily", () => {
    const settings = resolveSchedulerSettingsFromStoredValue(null, undefined);

    assert.equal(settings.schedulerEnabled, true);
    assert.equal(settings.schedulerMode, "daily");
    assert.equal(settings.schedulerCron, DEFAULT_SCHEDULER_CRON);
    assert.equal(settings.source, "default");
  });

  it("uses SYNC_CRON_SCHEDULE when no saved setting exists", () => {
    const settings = resolveSchedulerSettingsFromStoredValue(null, "30 5 * * *");

    assert.equal(settings.schedulerMode, "daily");
    assert.equal(settings.schedulerTime, "05:30");
    assert.equal(settings.schedulerCron, "30 5 * * *");
    assert.equal(settings.source, "environment");
  });

  it("lets saved settings override the environment fallback", () => {
    const saved = JSON.stringify({
      schedulerEnabled: true,
      schedulerMode: "weekly",
      schedulerCron: "0 3 * * 0",
      schedulerTime: "03:00",
      schedulerDayOfWeek: 0,
      schedulerIntervalHours: 6,
      updatedAt: "2026-07-04T00:00:00.000Z",
    });

    const settings = resolveSchedulerSettingsFromStoredValue(saved, "30 5 * * *");

    assert.equal(settings.schedulerMode, "weekly");
    assert.equal(settings.schedulerCron, "0 3 * * 0");
    assert.equal(settings.source, "database");
  });

  it("generates daily cron schedules", () => {
    const settings = buildSchedulerSettingsFromInput({
      schedulerMode: "daily",
      schedulerTime: "05:30",
    });

    assert.equal(generateSchedulerCron(settings), "30 5 * * *");
  });

  it("generates weekly cron schedules", () => {
    const settings = buildSchedulerSettingsFromInput({
      schedulerMode: "weekly",
      schedulerTime: "03:00",
      schedulerDayOfWeek: 0,
    });

    assert.equal(generateSchedulerCron(settings), "0 3 * * 0");
  });

  it("generates every-X-hours cron schedules", () => {
    const settings = buildSchedulerSettingsFromInput({
      schedulerMode: "interval",
      schedulerIntervalHours: 6,
    });

    assert.equal(generateSchedulerCron(settings), "0 */6 * * *");
  });

  it("rejects invalid custom cron expressions", () => {
    assert.throws(
      () => buildSchedulerSettingsFromInput({ schedulerMode: "custom", schedulerCron: "bad cron" }),
      SchedulerSettingsValidationError,
    );
  });
});
