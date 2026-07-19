import { createHash } from "crypto";

export const RECIPE_RESOLVER_VERSION = "2.3.3-1";
export const RECIPE_INHERITANCE_SCHEMA_VERSION = 1;
export const DEFAULT_MAX_RECIPE_INHERITANCE_DEPTH = 10;

export const RECIPE_LAYER_PRIORITY = {
  built_in_defaults: 10,
  global_defaults: 20,
  category_preset: 30,
  base_recipe: 40,
  transition_preset: 51,
  discovery_preset: 52,
  variety_preset: 53,
  automation_preset: 54,
  legacy_explicit: 59,
  recipe_override: 60,
  group_policy: 70,
  playlist_override: 80,
  user_preference: 90,
} as const;

export type RecipeLayerType = keyof typeof RECIPE_LAYER_PRIORITY;
export type ConflictSeverity = "informational" | "warning" | "blocking";
export type JsonObject = Record<string, unknown>;

export type RecipeValueSource = {
  type: RecipeLayerType | "policy_lock";
  id?: string | null;
  name: string;
  version?: number | string | null;
  priority: number;
};

export type RecipeResolutionLayer = Omit<RecipeValueSource, "type"> & {
  type: RecipeLayerType;
  values: JsonObject;
  allowedFields?: string[];
};

export type RecipeResolutionLock = {
  fieldPath: string;
  value: unknown;
  source: Omit<RecipeValueSource, "type" | "priority"> & { type?: string };
  authority: number;
  reason?: string | null;
};

export type RecipeConflictFinding = {
  severity: ConflictSeverity;
  code: string;
  fields: string[];
  message: string;
  winner?: RecipeValueSource;
  suppressed?: Array<{ value: unknown; source: RecipeValueSource }>;
  suggestion?: string;
};

export type EffectiveRecipeField = {
  field: string;
  effectiveValue: unknown;
  source: RecipeValueSource;
  inheritedValue?: unknown;
  inheritedFrom?: RecipeValueSource;
  isCustomized: boolean;
  isLocked: boolean;
  lock?: RecipeResolutionLock;
  overriddenValues: Array<{ value: unknown; source: RecipeValueSource }>;
  conflicts: RecipeConflictFinding[];
  state: "default" | "inherited" | "customized" | "locked" | "conflicting" | "invalid" | "legacy_explicit";
};

export type RecipeInheritanceNode = {
  id: string;
  name: string;
  baseRecipeId?: string | null;
};

export type RecipeResolutionResult = {
  valid: boolean;
  effectiveConfiguration: JsonObject;
  fields: EffectiveRecipeField[];
  inheritanceChain: RecipeValueSource[];
  conflicts: RecipeConflictFinding[];
  warnings: RecipeConflictFinding[];
  errors: RecipeConflictFinding[];
  lockedFields: RecipeResolutionLock[];
  fingerprint: string;
  resolverVersion: string;
  schemaVersion: number;
};

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function flattenRecipeValues(value: unknown, prefix = "", output = new Map<string, unknown>()) {
  if (!isObject(value)) {
    if (prefix) output.set(prefix, value);
    return output;
  }
  const entries = Object.entries(value);
  if (!entries.length && prefix) output.set(prefix, {});
  for (const [key, child] of entries) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isObject(child) && Object.keys(child).length) flattenRecipeValues(child, path, output);
    else output.set(path, child);
  }
  return output;
}

export function setRecipeValue(target: JsonObject, path: string, value: unknown) {
  const parts = path.split(".").filter(Boolean);
  if (!parts.length) return target;
  let cursor: JsonObject = target;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) cursor[part] = structuredClone(value);
    else {
      if (!isObject(cursor[part])) cursor[part] = {};
      cursor = cursor[part] as JsonObject;
    }
  });
  return target;
}

export function deleteRecipeValue(target: JsonObject, path: string) {
  const parts = path.split(".").filter(Boolean);
  const stack: Array<{ parent: JsonObject; key: string }> = [];
  let cursor: JsonObject = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const next = cursor[parts[index]];
    if (!isObject(next)) return target;
    stack.push({ parent: cursor, key: parts[index] });
    cursor = next;
  }
  delete cursor[parts.at(-1) || ""];
  for (const { parent, key } of stack.reverse()) {
    if (isObject(parent[key]) && Object.keys(parent[key] as JsonObject).length === 0) delete parent[key];
  }
  return target;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function recipeConfigurationFingerprint(value: unknown) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function sameValue(left: unknown, right: unknown) {
  return canonical(left) === canonical(right);
}

export function detectRecipeInheritanceCycle(nodes: RecipeInheritanceNode[], startId: string, proposedBaseId?: string | null, maxDepth = DEFAULT_MAX_RECIPE_INHERITANCE_DEPTH) {
  const parents = new Map(nodes.map((node) => [node.id, node.baseRecipeId || null]));
  if (proposedBaseId !== undefined) parents.set(startId, proposedBaseId);
  const names = new Map(nodes.map((node) => [node.id, node.name]));
  const ids: string[] = [];
  const seen = new Map<string, number>();
  let current: string | null | undefined = startId;
  while (current) {
    if (seen.has(current)) {
      const cycleIds = [...ids.slice(seen.get(current)), current];
      return { valid: false, code: "CIRCULAR_INHERITANCE", cycleIds, message: `Circular inheritance detected: ${cycleIds.map((id) => names.get(id) || id).join(" → ")}.` };
    }
    seen.set(current, ids.length);
    ids.push(current);
    if (ids.length > maxDepth + 1) return { valid: false, code: "MAXIMUM_DEPTH_EXCEEDED", cycleIds: ids, message: `Recipe inheritance may not exceed ${maxDepth} base-recipe levels.` };
    current = parents.get(current);
  }
  return { valid: true, code: null, cycleIds: ids, message: null };
}

function sourceFor(layer: RecipeResolutionLayer): RecipeValueSource {
  return { type: layer.type, id: layer.id, name: layer.name, version: layer.version, priority: layer.priority };
}

function crossFieldConflicts(configuration: JsonObject, sources: Map<string, RecipeValueSource>) {
  const values = flattenRecipeValues(configuration);
  const findings: RecipeConflictFinding[] = [];
  const compare = (minimum: string, maximum: string, code: string, label: string) => {
    const min = values.get(minimum);
    const max = values.get(maximum);
    if (typeof min === "number" && typeof max === "number" && min > max) findings.push({
      severity: "blocking", code, fields: [minimum, maximum],
      message: `${label} minimum (${min}) cannot be greater than its maximum (${max}).`,
      winner: sources.get(maximum), suggestion: `Lower ${minimum} or raise ${maximum}.`,
    });
  };
  compare("bpmFlow.minimumBpm", "bpmFlow.maximumBpm", "INVALID_BPM_RANGE", "BPM");
  compare("targets.minimumEnergy", "targets.maximumEnergy", "INVALID_ENERGY_RANGE", "Energy");
  const discovery = values.get("discovery.deepCutPercentage");
  const noNewTracks = values.get("generation.negativeFilters.excludePlayedWithinDays");
  if (typeof discovery === "number" && discovery > 0 && typeof noNewTracks === "number" && noNewTracks >= 3650) findings.push({
    severity: "warning", code: "DISCOVERY_EXCLUSION_CONFLICT", fields: ["discovery.deepCutPercentage", "generation.negativeFilters.excludePlayedWithinDays"],
    message: "Discovery is enabled while the play-history exclusion is extremely restrictive.", suggestion: "Reduce the exclusion window or discovery target.",
  });
  return findings;
}

export function resolveRecipeConfiguration(input: { layers: RecipeResolutionLayer[]; locks?: RecipeResolutionLock[] }): RecipeResolutionResult {
  const layers = input.layers.map((layer, index) => ({ ...layer, priority: layer.priority ?? RECIPE_LAYER_PRIORITY[layer.type], _order: index }))
    .sort((left, right) => left.priority - right.priority || left._order - right._order);
  const effective: JsonObject = {};
  const sources = new Map<string, RecipeValueSource>();
  const histories = new Map<string, Array<{ value: unknown; source: RecipeValueSource }>>();
  const conflicts: RecipeConflictFinding[] = [];

  for (const layer of layers) {
    const source = sourceFor(layer);
    const allowed = layer.allowedFields ? new Set(layer.allowedFields) : null;
    for (const [field, value] of Array.from(flattenRecipeValues(layer.values).entries())) {
      if (allowed && !allowed.has(field)) {
        conflicts.push({ severity: "warning", code: "USER_OVERRIDE_NOT_ALLOWED", fields: [field], message: `${field} is not eligible for the ${layer.name} layer.`, suppressed: [{ value, source }], suggestion: "Ask an administrator to allow this preference field." });
        continue;
      }
      const previousSource = sources.get(field);
      const previousValue = flattenRecipeValues(effective).get(field);
      if (previousSource && !sameValue(previousValue, value)) {
        const history = histories.get(field) || [];
        history.push({ value: previousValue, source: previousSource });
        histories.set(field, history);
        if (layer.type === "group_policy" && previousSource.type === "group_policy") conflicts.push({
          severity: "warning", code: "GROUP_POLICY_CONFLICT", fields: [field], message: `${layer.name} overrides ${previousSource.name} for ${field} by explicit priority.`,
          winner: source, suppressed: [{ value: previousValue, source: previousSource }], suggestion: "Choose one primary policy group or remove the duplicate group value.",
        });
      }
      setRecipeValue(effective, field, value);
      sources.set(field, source);
    }
  }

  const winningLocks = new Map<string, RecipeResolutionLock>();
  for (const lock of [...(input.locks || [])].sort((a, b) => b.authority - a.authority)) {
    if (!winningLocks.has(lock.fieldPath)) winningLocks.set(lock.fieldPath, lock);
  }
  for (const [field, lock] of Array.from(winningLocks.entries())) {
    const previousValue = flattenRecipeValues(effective).get(field);
    const previousSource = sources.get(field);
    const lockSource: RecipeValueSource = { type: "policy_lock", id: lock.source.id, name: lock.source.name, version: lock.source.version, priority: 1000 + lock.authority };
    if (previousSource && !sameValue(previousValue, lock.value)) {
      const suppressed = { value: previousValue, source: previousSource };
      histories.set(field, [...(histories.get(field) || []), suppressed]);
      conflicts.push({ severity: "blocking", code: "LOCKED_FIELD_OVERRIDE", fields: [field], message: `${previousSource.name} requested a value for ${field}, but ${lock.source.name} locks it${lock.reason ? `: ${lock.reason}` : "."}`, winner: lockSource, suppressed: [suppressed], suggestion: "Remove the suppressed override or contact an administrator." });
    }
    setRecipeValue(effective, field, lock.value);
    sources.set(field, lockSource);
  }

  conflicts.push(...crossFieldConflicts(effective, sources));
  const fieldConflicts = (field: string) => conflicts.filter((finding) => finding.fields.includes(field));
  const fields = Array.from(sources.entries()).sort(([left], [right]) => left.localeCompare(right)).map(([field, source]): EffectiveRecipeField => {
    const history = histories.get(field) || [];
    const inherited = history.at(-1);
    const locked = winningLocks.get(field);
    const relevant = fieldConflicts(field);
    const customized = source.type === "recipe_override" || source.type === "playlist_override" || source.type === "user_preference";
    const state = locked ? "locked" : relevant.some((item) => item.severity === "blocking") ? "invalid" : relevant.length ? "conflicting" : source.type === "built_in_defaults" || source.type === "global_defaults" ? "default" : source.type === "legacy_explicit" ? "legacy_explicit" : customized ? "customized" : "inherited";
    return { field, effectiveValue: flattenRecipeValues(effective).get(field), source, inheritedValue: inherited?.value, inheritedFrom: inherited?.source, isCustomized: customized, isLocked: Boolean(locked), lock: locked, overriddenValues: history, conflicts: relevant, state };
  });
  const errors = conflicts.filter((finding) => finding.severity === "blocking");
  return {
    valid: errors.length === 0,
    effectiveConfiguration: effective,
    fields,
    inheritanceChain: layers.map(sourceFor),
    conflicts,
    warnings: conflicts.filter((finding) => finding.severity !== "blocking"),
    errors,
    lockedFields: Array.from(winningLocks.values()),
    fingerprint: recipeConfigurationFingerprint(effective),
    resolverVersion: RECIPE_RESOLVER_VERSION,
    schemaVersion: RECIPE_INHERITANCE_SCHEMA_VERSION,
  };
}

export function compareEffectiveRecipes(before: RecipeResolutionResult, after: RecipeResolutionResult) {
  const left = new Map(before.fields.map((field) => [field.field, field]));
  const right = new Map(after.fields.map((field) => [field.field, field]));
  return Array.from(new Set([...Array.from(left.keys()), ...Array.from(right.keys())])).sort().flatMap((field) => {
    const previous = left.get(field);
    const next = right.get(field);
    if (previous && next && sameValue(previous.effectiveValue, next.effectiveValue) && previous.source.type === next.source.type && previous.source.id === next.source.id && previous.isLocked === next.isLocked) return [];
    return [{ field, before: previous || null, after: next || null, effectiveValueChanged: !sameValue(previous?.effectiveValue, next?.effectiveValue), sourceChanged: previous?.source.id !== next?.source.id || previous?.source.type !== next?.source.type, lockChanged: previous?.isLocked !== next?.isLocked }];
  });
}
