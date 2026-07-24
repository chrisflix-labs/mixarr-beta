# AI per-request cost limits

Per-request cost enforcement is explicit at the global, provider, and user
scopes. Every scope stores an enabled boolean separately from its USD amount.
A missing, blank, zero, or stale amount does not participate unless its enabled
boolean is exactly `true`; an enabled amount must be a positive decimal with no
more than six decimal places.

When more than one scope is enabled, Mixarr applies the strictest amount. Only
the provider selected for the request is considered. If equal amounts exist,
the most specific source is reported: user, then provider, then global. This
source is returned in preflight diagnostics, structured policy logs, and
`AI_REQUEST_COST_LIMIT_EXCEEDED` responses.

The versioned upgrade migration and Docker `db push` preflight both convert a positive legacy
`maximumCumulativeRequestCost` into an enabled global per-request limit.
Legacy zero and null values become disabled/unlimited and zero is cleared from
the retry cumulative field. Provider and user limits start disabled. Existing
daily and monthly budgets, request counts, token limits, provider budgets, user
limits, retry limits, and approval/privacy controls are not changed.

Policy settings are read directly from Prisma for each preview and again during
the serializable budget reservation immediately before dispatch. The API and
settings client use no-store/dynamic requests, so saving a limit takes effect
without restarting Mixarr or invalidating an application-level policy cache.
