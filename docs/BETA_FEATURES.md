# Beta features and advanced flags

Mixarr 2.0.10 extends the v1.5.x `betaFeatureSettings` system. Existing JSON settings remain readable; new per-user preferences, access grants, overrides, usage, and feedback reports are stored in dedicated tables.

## Safety model

Feature resolution is authoritative on the server and follows this order: server access ceiling, environment override, required access level, administrator restriction, user beta opt-in, individual enablement, emergency switch, and runtime support. Hiding a control is never the security boundary.

The server ceiling is configured with `MIXARR_BETA_PROGRAM_ENABLED`, `MIXARR_PRIVATE_BETA_ENABLED`, and `MIXARR_DEVELOPER_FEATURES_ENABLED`. Developer features are unavailable in production. `MIXARR_DISABLE_ALL_EXPERIMENTAL_FEATURES` and `MIXARR_DISABLED_FEATURES` take precedence immediately and do not delete saved configuration.

The first existing account becomes the initial administrator during migration. The first account on a new install is bootstrapped as administrator. Additional identifiers can be listed in `MIXARR_ADMIN_USER_IDS`.

## Scoring models

`stable-v2` remains the default Smart Mix v2 model. `experimental-balanced` is available only through `smartMix.experimentalScoring`; it pulls extreme saved weights toward balanced targets and increases artist/album variety. If an unavailable experimental model is requested with fallback enabled, the complete request resolves to Stable v2 before generation begins and reports the fallback.

## Support and privacy

Configure `BETA_FEEDBACK_URL`, `GITHUB_ISSUES_URL`, and `DISCORD_SUPPORT_URL` to expose support actions. Only validated HTTP(S) URLs are returned. Feedback reports remove secret-like fields, authentication values, cookies, and filesystem paths. Reports are stored locally; Mixarr does not add external telemetry.

GitHub Sponsors messaging is shown only when `GITHUB_SPONSORS_URL` is valid. It is informational and does not claim verified sponsorship or gate stable functionality.
