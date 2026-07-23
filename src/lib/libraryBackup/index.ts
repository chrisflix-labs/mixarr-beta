/**
 * Library Intelligence Backup & Restore (v2.4.11) — public barrel.
 *
 * Import pure helpers (archiveFormat, trackMatching, scopeDescription) directly
 * from their modules in client-safe code. Server-only modules (which import
 * Prisma) are re-exported here for API routes.
 */
export * from "./archiveFormat";
export * from "./trackMatching";
export * from "./scopeDescription";
export * from "./zipArchive";
export * from "./restoreReader";
export * from "./backupStorage";
export * from "./backupBuilder";
export * from "./backupCoverage";
export * from "./backupJobs";
export * from "./restoreService";
