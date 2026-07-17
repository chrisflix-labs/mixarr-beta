import { createHash } from "crypto";

export const PLAYLIST_PRIORITY_WEIGHT = { HIGH: 100, NORMAL: 50, LOW: 10 } as const;
export type PlaylistPriorityValue = keyof typeof PLAYLIST_PRIORITY_WEIGHT;

export const AUTOMATION_STATES = ["ACTIVE", "PAUSED", "DISABLED", "WAITING", "RUNNING", "BLOCKED", "ERROR"] as const;
export type AutomationStateValue = typeof AUTOMATION_STATES[number];

const STATE_TRANSITIONS: Record<AutomationStateValue, ReadonlySet<AutomationStateValue>> = {
  ACTIVE: new Set<AutomationStateValue>(["PAUSED", "DISABLED", "WAITING", "RUNNING", "BLOCKED", "ERROR"]),
  PAUSED: new Set<AutomationStateValue>(["ACTIVE", "DISABLED"]),
  DISABLED: new Set<AutomationStateValue>(["ACTIVE"]),
  WAITING: new Set<AutomationStateValue>(["ACTIVE", "PAUSED", "DISABLED", "RUNNING", "BLOCKED", "ERROR"]),
  RUNNING: new Set<AutomationStateValue>(["ACTIVE", "PAUSED", "DISABLED", "BLOCKED", "ERROR"]),
  BLOCKED: new Set<AutomationStateValue>(["ACTIVE", "PAUSED", "DISABLED", "WAITING", "ERROR"]),
  ERROR: new Set<AutomationStateValue>(["ACTIVE", "PAUSED", "DISABLED", "WAITING"]),
};

export function canTransitionAutomationState(from: AutomationStateValue, to: AutomationStateValue, administrativeOverride = false) {
  return administrativeOverride || (from !== to && STATE_TRANSITIONS[from].has(to));
}

export function assertAutomationStateTransition(from: AutomationStateValue, to: AutomationStateValue, administrativeOverride = false) {
  if (!canTransitionAutomationState(from, to, administrativeOverride)) {
    throw new OrchestrationDomainError("INVALID_AUTOMATION_STATE_TRANSITION", `Automation cannot transition from ${from} to ${to}.`, { from, to });
  }
}

export type DependencyEdge = { sourceId: string; targetId: string; type: "DEPENDS_ON" | "RUNS_AFTER" | "RELATED"; enabled?: boolean };

export function dependencyGraph(edges: DependencyEdge[]) {
  const graph = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.enabled === false || edge.type === "RELATED") continue;
    if (!graph.has(edge.sourceId)) graph.set(edge.sourceId, new Set());
    if (!graph.has(edge.targetId)) graph.set(edge.targetId, new Set());
    graph.get(edge.sourceId)!.add(edge.targetId);
  }
  return graph;
}

export function findDependencyCycle(edges: DependencyEdge[]) {
  const graph = dependencyGraph(edges);
  const visited = new Set<string>();
  const active = new Set<string>();
  const stack: string[] = [];

  function visit(node: string): string[] | null {
    visited.add(node); active.add(node); stack.push(node);
    for (const dependency of Array.from(graph.get(node) || [])) {
      if (!visited.has(dependency)) {
        const cycle = visit(dependency);
        if (cycle) return cycle;
      } else if (active.has(dependency)) {
        const start = stack.indexOf(dependency);
        return stack.slice(start).concat(dependency);
      }
    }
    stack.pop(); active.delete(node);
    return null;
  }

  for (const node of Array.from(graph.keys()).sort()) {
    if (!visited.has(node)) {
      const cycle = visit(node);
      if (cycle) return cycle;
    }
  }
  return null;
}

export function topologicalPlaylistOrder(ids: string[], edges: DependencyEdge[]) {
  const nodes = new Set(ids);
  for (const edge of edges) { nodes.add(edge.sourceId); nodes.add(edge.targetId); }
  const cycle = findDependencyCycle(edges);
  if (cycle) throw new OrchestrationDomainError("CIRCULAR_DEPENDENCY", `Circular dependency detected: ${cycle.join(" -> ")}.`, { cycle });
  const graph = dependencyGraph(edges);
  const seen = new Set<string>();
  const order: string[] = [];
  function visit(node: string) {
    if (seen.has(node)) return;
    seen.add(node);
    for (const dependency of Array.from(graph.get(node) || []).sort()) visit(dependency);
    order.push(node);
  }
  for (const node of Array.from(nodes).sort()) visit(node);
  return order;
}

export function orchestrationConflictKeys(input: { managedPlaylistId: string; plexPlaylistId: string; playlistIdentityId?: string | null; libraryId: string; writesPlaylist?: boolean }) {
  const keys = [`playlist:${input.managedPlaylistId}`, `plex-playlist:${input.plexPlaylistId}`];
  if (input.playlistIdentityId) keys.push(`playlist-identity:${input.playlistIdentityId}`);
  if (input.writesPlaylist !== false) keys.push(`library:${input.libraryId}:playlist-write`);
  return Array.from(new Set(keys)).sort();
}

export function orchestrationIdempotencyKey(input: { managedPlaylistId: string; jobType: string; trigger: string; scheduledFor?: Date | string | null; configuration?: unknown; requestKey?: string | null }) {
  if (input.requestKey) return `client:${createHash("sha256").update(input.requestKey).digest("hex")}`;
  const date = input.scheduledFor ? new Date(input.scheduledFor) : new Date();
  const window = input.trigger === "SCHEDULED"
    ? date.toISOString().slice(0, 16)
    : date.toISOString().slice(0, 13);
  const configHash = createHash("sha256").update(stableStringify(input.configuration ?? {})).digest("hex").slice(0, 20);
  return [input.managedPlaylistId, input.jobType, input.trigger, window, configHash].join(":");
}

export function effectiveJobPriority(playlistPriority: PlaylistPriorityValue, explicitPriority: number, requestedAt: Date | string, now = Date.now()) {
  const ageHours = Math.max(0, now - new Date(requestedAt).getTime()) / 3_600_000;
  const agingBonus = Math.min(90, Math.floor(ageHours / 6) * 5);
  return PLAYLIST_PRIORITY_WEIGHT[playlistPriority] + explicitPriority + agingBonus;
}

export function sortEligibleJobs<T extends { playlistPriority: PlaylistPriorityValue; priority: number; requestedAt: Date | string; scheduledFor: Date | string }>(jobs: T[], now = Date.now()) {
  return [...jobs].sort((a, b) =>
    effectiveJobPriority(b.playlistPriority, b.priority, b.requestedAt, now) - effectiveJobPriority(a.playlistPriority, a.priority, a.requestedAt, now)
    || new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime()
    || new Date(a.requestedAt).getTime() - new Date(b.requestedAt).getTime());
}

export function isOrchestrationLockStale(lock: { heartbeatAt?: Date | string | null; leaseExpiresAt: Date | string }, now = Date.now()) {
  const lease = new Date(lock.leaseExpiresAt).getTime();
  const heartbeat = lock.heartbeatAt ? new Date(lock.heartbeatAt).getTime() : 0;
  return !Number.isFinite(lease) || lease <= now || !Number.isFinite(heartbeat);
}

export function evaluatePlaylistEligibility(input: { globalEnabled: boolean; enabled: boolean; automationEnabled: boolean; automationState: AutomationStateValue; plexAvailable: boolean; manual?: boolean }) {
  if (!input.globalEnabled) return { eligible: false, code: "GLOBAL_ORCHESTRATION_DISABLED" };
  if (!input.enabled || !input.plexAvailable) return { eligible: false, code: "PLAYLIST_UNAVAILABLE" };
  if (!input.manual && !input.automationEnabled) return { eligible: false, code: "PLAYLIST_AUTOMATION_DISABLED" };
  if (["PAUSED", "DISABLED", "ERROR", "RUNNING"].includes(input.automationState)) return { eligible: false, code: `PLAYLIST_${input.automationState}` };
  return { eligible: true, code: "READY" };
}

export function operationMayWritePlex(jobType: string, dryRun: boolean) {
  return !dryRun && ["GENERATE", "REGENERATE", "SYNC"].includes(jobType);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

export class OrchestrationDomainError extends Error {
  constructor(public code: string, message: string, public details?: Record<string, unknown>) { super(message); }
}
