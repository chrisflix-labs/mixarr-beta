// One authoritative reader for boolean environment variables.
//
// `.env.example` documents two conventions side by side — numeric (`DEEZER_TAGS_ENABLED=1`,
// `DISCOGS_TAGS_ENABLED=0`) and textual (`COMMUNITY_RECIPES_ENABLED=true`) — but the
// code grew three different parsers. Flags compared only against the literal
// string `"false"` silently ignored `0`, `no`, and `off`, so an administrator who
// followed the numeric convention from the same file left the feature switched on.
// For fail-open flags such as AI_PLAYLIST_SUMMARIES_ENABLED that meant an AI
// feature the administrator believed disabled kept issuing provider requests.
//
// Both conventions are accepted here, in both directions. An unset or blank value
// keeps the caller's documented default; an unrecognized value also keeps the
// default rather than guessing, and is reported by `describeEnvBooleanIssue` so
// startup diagnostics can surface the typo instead of silently flipping a switch.

const TRUE_LIST = ["1", "true", "yes", "y", "on", "enabled", "enable"] as const;
const TRUE_VALUES = new Set<string>(TRUE_LIST);
const FALSE_LIST = ["0", "false", "no", "n", "off", "disabled", "disable"] as const;
const FALSE_VALUES = new Set<string>(FALSE_LIST);

/** Normalizes a raw environment value, or returns null when it is absent/blank. */
function normalize(value: string | undefined | null) {
  if (value == null) return null;
  const source = String(value).trim().toLowerCase();
  return source === "" ? null : source;
}

/**
 * Resolves a boolean environment variable.
 *
 * `defaultValue` is the documented behaviour when the variable is unset, blank,
 * or unrecognized — it is never inferred.
 */
export function envBoolean(value: string | undefined | null, defaultValue: boolean): boolean {
  const source = normalize(value);
  if (source == null) return defaultValue;
  if (TRUE_VALUES.has(source)) return true;
  if (FALSE_VALUES.has(source)) return false;
  return defaultValue;
}

/** Reads `process.env[name]` through {@link envBoolean}. */
export function envFlag(name: string, defaultValue: boolean, environment: Record<string, string | undefined> = process.env): boolean {
  return envBoolean(environment[name], defaultValue);
}

/**
 * Returns an operator-facing sentence when a variable holds a value this module
 * cannot interpret, otherwise null. Contains the variable name and the accepted
 * values only — never the configured value, which may be a pasted secret.
 */
export function describeEnvBooleanIssue(name: string, value: string | undefined | null, defaultValue: boolean): string | null {
  const source = normalize(value);
  if (source == null || TRUE_VALUES.has(source) || FALSE_VALUES.has(source)) return null;
  return `${name} is not a recognized boolean. Use one of ${TRUE_LIST.join(", ")} or ${FALSE_LIST.join(", ")}. Falling back to the default (${defaultValue ? "enabled" : "disabled"}).`;
}

export const ENV_BOOLEAN_TRUE_VALUES = Object.freeze([...TRUE_LIST]);
export const ENV_BOOLEAN_FALSE_VALUES = Object.freeze([...FALSE_LIST]);
