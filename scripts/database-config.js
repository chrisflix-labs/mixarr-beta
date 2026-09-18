const { readFileSync } = require('node:fs');

// This module never includes configuration values in errors. In particular,
// URL/parser and filesystem exceptions can contain credentials or secret paths.
class DatabaseConfigError extends Error {}
const fail = (message) => { throw new DatabaseConfigError(message); };

function readSetting(env, name) {
  if (env[`${name}_FILE`]) {
    if (env[name]) fail(`Set only ${name} or ${name}_FILE, not both.`);
    try {
      // Match the official Postgres entrypoint's trailing-newline handling.
      return readFileSync(env[`${name}_FILE`], 'utf8').replace(/\n+$/, '');
    } catch {
      fail(`Cannot read ${name}_FILE. Check the secret mount and permissions.`);
    }
  }
  return env[name];
}

function resolveDatabaseConfig(env) {
  const settings = {};
  for (const name of ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB', 'DATABASE_URL']) {
    settings[name] = readSetting(env, name);
  }
  let value = settings.DATABASE_URL;
  if (!value) {
    for (const name of ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB']) {
      if (!settings[name]) fail(`${name} is required when DATABASE_URL is unset.`);
    }
    const host = env.POSTGRES_HOST ?? 'db';
    const port = env.POSTGRES_PORT ?? '5432';
    if (!/^(?:[a-zA-Z0-9_.-]+|\[[a-fA-F0-9:]+\])$/.test(host)) fail('POSTGRES_HOST is invalid.');
    if (!/^\d+$/.test(port) || +port < 1 || +port > 65535) fail('POSTGRES_PORT is invalid.');
    try {
      value = `postgresql://${encodeURIComponent(settings.POSTGRES_USER)}:${encodeURIComponent(settings.POSTGRES_PASSWORD)}@${host}:${port}/${encodeURIComponent(settings.POSTGRES_DB)}?schema=public`;
    } catch {
      fail('Database credentials contain invalid Unicode.');
    }
  }

  let url, user, password, database;
  try {
    url = new URL(value);
    user = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
    database = decodeURIComponent(url.pathname.slice(1));
  } catch {
    fail('DATABASE_URL is invalid. Percent-encode its username, password and database components.');
  }
  // Reject WHATWG URL normalization of raw delimiters/whitespace instead of
  // allowing Node and Prisma to interpret the same input differently.
  const authority = value.match(/^postgres(?:ql)?:\/\/([^/]+)\//)?.[1];
  const userInfo = authority?.slice(0, authority.lastIndexOf('@'));
  if (!['postgresql:', 'postgres:'].includes(url.protocol) || !url.hostname || !user || !password || !database || url.hash ||
      /\s|\\/.test(value) || !userInfo || !/^(?:[^:@/?#%]|%[0-9a-f]{2})+:(?:[^:@/?#%]|%[0-9a-f]{2})+$/i.test(userInfo) ||
      url.pathname.slice(1).includes('/')) {
    fail('DATABASE_URL must be a PostgreSQL URL with a host, user, password and database; percent-encode special characters in credentials.');
  }
  const expected = { POSTGRES_USER: user, POSTGRES_PASSWORD: password, POSTGRES_DB: database,
    POSTGRES_HOST: url.hostname, POSTGRES_PORT: url.port || '5432' };
  for (const [name, actual] of Object.entries(expected)) {
    const configured = name in settings ? settings[name] : env[name];
    if (configured !== undefined && configured !== actual) {
      fail(`DATABASE_URL disagrees with ${name}. Use one set of database settings; remove a stale URL or correct the conflicting value.`);
    }
  }
  return { url: value, metadata: { host: url.hostname, port: url.port || '5432', database, user, passwordConfigured: true } };
}

module.exports = { DatabaseConfigError, resolveDatabaseConfig };
