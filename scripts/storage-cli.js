#!/usr/bin/env node

const command = process.argv[2] || "report";
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required. Run this command with the same environment as Mixarr.");
  process.exit(2);
}

async function main() {
  const maintenance = require("../.test-dist/src/lib/storageMaintenance.js");
  if (command === "report") {
    console.log(JSON.stringify(await maintenance.getStorageDiagnostics(), null, 2));
    return;
  }
  if (command !== "cleanup") throw new Error(`Unknown command: ${command}`);
  const confirmed = process.argv.includes("--confirm");
  const result = await maintenance.runStorageCleanup({ scope: "expired", dryRun: !confirmed });
  console.log(JSON.stringify(result, null, 2));
  if (!confirmed) console.log("Dry run only. Re-run the cleanup command with its confirmation form to apply this exact bounded cleanup.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
