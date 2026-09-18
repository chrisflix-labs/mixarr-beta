const { spawn } = require('node:child_process');
const { DatabaseConfigError, resolveDatabaseConfig } = require('./database-config');

async function checkDatabase(queries) {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient({ log: [] });
  try {
    // Prisma 5.14's lazy query initialization can omit errorCode. Connecting
    // explicitly preserves P1000 so operators get the reconciliation guidance.
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
    console.log('[Database] Prisma authentication: OK');
    if (queries) {
      await prisma.track.count();
      await prisma.syncSettings.findUnique({ where: { userId: '__mixarr_connectivity_probe__' } });
      console.log('[Database] track.count() and syncSettings.findUnique(): OK');
    }
  } catch (error) {
    const code = error.code || error.errorCode;
    const safeCode = /^P\d{4}$/.test(code) ? code : 'unknown';
    console.error(`[Database] Prisma connection/query check failed (${safeCode}).`);
    if (safeCode === 'P1000') {
      console.error('[Database] PostgreSQL rejected the credentials. POSTGRES_* does not update roles in an existing volume. Reconcile the role password using an existing administrator; see docs/DATABASE_AUTH.md. Preserve the database volume.');
    } else {
      console.error('[Database] Check the database service, connection settings and schema. See docs/DATABASE_AUTH.md.');
    }
    process.exitCode = 1;
    return false;
  } finally {
    await prisma.$disconnect();
  }
  return true;
}

async function main() {
  const config = resolveDatabaseConfig(process.env);
  process.env.DATABASE_URL = config.url;
  console.log(`[Database] ${JSON.stringify(config.metadata)}`);
  const args = process.argv.slice(2);
  if (args[0] === '--check-config') return;
  if (!(await checkDatabase(args[0] === '--check-queries'))) return;
  if (args[0] === '--check-auth' || args[0] === '--check-queries') return;
  if (!args.length) throw new DatabaseConfigError('No startup command supplied.');
  // The existing compatibility schema/backfill sequence receives the exact URL
  // we authenticated with, as does the server it starts. Never invoke a shell
  // with interpolated credentials or write the generated URL to disk.
  const child = spawn(args[0], args.slice(1), { stdio: 'inherit', env: process.env });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
  child.on('error', () => { console.error('[Database] Could not launch the startup command.'); process.exitCode = 1; });
  child.on('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGTERM' ? 143 : 130); });
}

main().catch((error) => {
  console.error(`[Database] ${error instanceof DatabaseConfigError ? error.message : 'Startup failed. Check the database configuration and installed Prisma client.'}`);
  process.exitCode = 1;
});
