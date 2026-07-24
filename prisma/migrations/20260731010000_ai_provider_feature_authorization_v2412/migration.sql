-- Mixarr v2.4.12: AI provider feature authorization consistency hotfix.
--
-- Canonicalizes legacy/variant AI feature identifiers stored in the JSON
-- feature allowlists so every layer authorizes against the same canonical IDs.
-- This migration:
--   * is fully idempotent (safe to run more than once; re-running is a no-op),
--   * preserves every existing explicit approval (aliases map to their canonical
--     target, nothing is added that was not already present),
--   * grants no new permissions and never approves a feature that was unapproved,
--   * de-duplicates array entries so each canonical feature appears at most once,
--   * does not enable AI, external providers, paid fallback, or metadata writes.
--
-- The per-provider allowlist (AiProviderConfig.allowedFeaturesJson) is the
-- authoritative provider-feature approval control. The legacy global list
-- (AiGovernanceSetting.allowedExternalFeaturesJson) is retained for backward
-- compatibility and is normalized here, but it is no longer an independent
-- authorization gate.

CREATE OR REPLACE FUNCTION mixarr_canonical_ai_feature(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(regexp_replace(btrim(input), '[[:space:]-]+', '_', 'g'))
    WHEN 'recipe-copilot' THEN 'recipe_copilot'
    WHEN 'recipecopilot' THEN 'recipe_copilot'
    WHEN 'recipe_generation' THEN 'recipe_copilot'
    WHEN 'recipe_suggestions' THEN 'recipe_copilot'
    WHEN 'natural_language_playlist_request' THEN 'natural_language_playlist_requests'
    WHEN 'library_analysis' THEN 'metadata_suggestions'
    ELSE lower(regexp_replace(btrim(input), '[[:space:]-]+', '_', 'g'))
  END;
$$;

-- Provider per-feature allowlist (authoritative provider-feature approval).
UPDATE "AiProviderConfig" AS target
SET "allowedFeaturesJson" = canonicalized.arr
FROM (
  SELECT source.id,
         COALESCE(jsonb_agg(DISTINCT mixarr_canonical_ai_feature(elem)), '[]'::jsonb) AS arr
  FROM "AiProviderConfig" AS source
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(source."allowedFeaturesJson"::jsonb) = 'array'
         THEN source."allowedFeaturesJson"::jsonb ELSE '[]'::jsonb END
  ) AS elem
  GROUP BY source.id
) AS canonicalized
WHERE target.id = canonicalized.id
  AND target."allowedFeaturesJson"::jsonb IS DISTINCT FROM canonicalized.arr;

-- Model per-feature allowlist.
UPDATE "AiProviderModel" AS target
SET "allowedFeaturesJson" = canonicalized.arr
FROM (
  SELECT source.id,
         COALESCE(jsonb_agg(DISTINCT mixarr_canonical_ai_feature(elem)), '[]'::jsonb) AS arr
  FROM "AiProviderModel" AS source
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(source."allowedFeaturesJson"::jsonb) = 'array'
         THEN source."allowedFeaturesJson"::jsonb ELSE '[]'::jsonb END
  ) AS elem
  GROUP BY source.id
) AS canonicalized
WHERE target.id = canonicalized.id
  AND target."allowedFeaturesJson"::jsonb IS DISTINCT FROM canonicalized.arr;

-- Legacy global external-features list (normalized for backward compatibility).
UPDATE "AiGovernanceSetting" AS target
SET "allowedExternalFeaturesJson" = canonicalized.arr
FROM (
  SELECT source.id,
         COALESCE(jsonb_agg(DISTINCT mixarr_canonical_ai_feature(elem)), '[]'::jsonb) AS arr
  FROM "AiGovernanceSetting" AS source
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(source."allowedExternalFeaturesJson"::jsonb) = 'array'
         THEN source."allowedExternalFeaturesJson"::jsonb ELSE '[]'::jsonb END
  ) AS elem
  GROUP BY source.id
) AS canonicalized
WHERE target.id = canonicalized.id
  AND target."allowedExternalFeaturesJson"::jsonb IS DISTINCT FROM canonicalized.arr;

DROP FUNCTION mixarr_canonical_ai_feature(text);
