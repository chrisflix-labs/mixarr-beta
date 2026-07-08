INSERT INTO "SystemState" ("key", "value", "updatedAt")
VALUES (
  'betaFeatureSettings',
  '{"enableExperimentalFeatures":false,"flags":{"showBetaCards":false,"enableV2PreviewCards":false}}',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;
