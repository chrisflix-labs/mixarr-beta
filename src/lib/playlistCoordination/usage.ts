export const HISTORICAL_USAGE_HALF_LIFE_DAYS = 90;

export function decayedHistoricalUsageWeight(occurredAt: Date, now = new Date()) {
  const ageDays = Math.max(0, (now.getTime() - occurredAt.getTime()) / 86_400_000);
  return Math.pow(0.5, ageDays / HISTORICAL_USAGE_HALF_LIFE_DAYS);
}

export function aggregateHistoricalUsage(events: Array<{ trackKey: string; occurredAt: Date }>, now = new Date()) {
  const usage: Record<string, number> = {};
  for (const event of events) {
    usage[event.trackKey] = Math.round(((usage[event.trackKey] || 0) + decayedHistoricalUsageWeight(event.occurredAt, now)) * 1000) / 1000;
  }
  return usage;
}
