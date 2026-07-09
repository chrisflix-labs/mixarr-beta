import prisma from "./prisma";
import {
  builtInSmartMixTuningPresets,
  normalizeSmartMixTuningConfig,
  SMART_MIX_TUNING_VERSION,
  type SmartMixTuningConfig,
  type SmartMixTuningPreset,
} from "./smartMixEngine/v2";

let tuningPresetSchemaPromise: Promise<void> | null = null;

function createPresetId() {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === "function") return randomUUID.call(globalThis.crypto);
  return `tuning_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function jsonParam(value: unknown) {
  return JSON.stringify(value);
}

async function ensureSmartMixTuningPresetTable() {
  if (!tuningPresetSchemaPromise) {
    tuningPresetSchemaPromise = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "SmartMixTuningPreset" (
          "id" TEXT NOT NULL,
          "userId" TEXT NOT NULL,
          "name" TEXT NOT NULL,
          "configJson" JSONB NOT NULL,
          "tuningVersion" TEXT NOT NULL DEFAULT '${SMART_MIX_TUNING_VERSION}',
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "SmartMixTuningPreset_pkey" PRIMARY KEY ("id")
        )
      `);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SmartMixTuningPreset_userId_updatedAt_idx" ON "SmartMixTuningPreset"("userId", "updatedAt")`);
      await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "SmartMixTuningPreset_userId_name_key" ON "SmartMixTuningPreset"("userId", "name")`);
      await prisma.$executeRawUnsafe(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SmartMixTuningPreset_userId_fkey') THEN
            ALTER TABLE "SmartMixTuningPreset" ADD CONSTRAINT "SmartMixTuningPreset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
          END IF;
        END $$;
      `);
    })().catch((error) => {
      tuningPresetSchemaPromise = null;
      throw error;
    });
  }

  return tuningPresetSchemaPromise;
}

function mapCustomPreset(row: any): SmartMixTuningPreset {
  const config = normalizeSmartMixTuningConfig({
    ...(row.configJson || {}),
    presetName: row.name,
  });
  return {
    id: row.id,
    name: row.name,
    description: "Saved custom tuning preset.",
    builtIn: false,
    config,
  };
}

export async function listSmartMixTuningPresets(userId: string) {
  await ensureSmartMixTuningPresetTable();
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM "SmartMixTuningPreset" WHERE "userId" = $1 ORDER BY "updatedAt" DESC`,
    userId,
  );

  return {
    builtInPresets: builtInSmartMixTuningPresets,
    customPresets: rows.map(mapCustomPreset),
  };
}

export async function saveSmartMixTuningPreset({
  userId,
  name,
  config,
}: {
  userId: string;
  name: string;
  config: unknown;
}) {
  await ensureSmartMixTuningPresetTable();
  const trimmedName = name.trim().slice(0, 120);
  if (!trimmedName) throw new Error("Preset name is required.");

  const normalizedConfig: SmartMixTuningConfig = normalizeSmartMixTuningConfig({
    ...normalizeSmartMixTuningConfig(config),
    presetName: trimmedName,
  });
  const id = createPresetId();
  const [row] = await prisma.$queryRawUnsafe<any[]>(
    `INSERT INTO "SmartMixTuningPreset" ("id", "userId", "name", "configJson", "tuningVersion", "updatedAt")
     VALUES ($1, $2, $3, $4::jsonb, $5, CURRENT_TIMESTAMP)
     ON CONFLICT ("userId", "name")
     DO UPDATE SET "configJson" = EXCLUDED."configJson", "tuningVersion" = EXCLUDED."tuningVersion", "updatedAt" = CURRENT_TIMESTAMP
     RETURNING *`,
    id,
    userId,
    trimmedName,
    jsonParam(normalizedConfig),
    SMART_MIX_TUNING_VERSION,
  );

  return mapCustomPreset(row);
}

export async function deleteSmartMixTuningPreset(userId: string, presetId: string) {
  await ensureSmartMixTuningPresetTable();
  const result = await prisma.$executeRawUnsafe(
    `DELETE FROM "SmartMixTuningPreset" WHERE "id" = $1 AND "userId" = $2`,
    presetId,
    userId,
  );
  return result > 0;
}
