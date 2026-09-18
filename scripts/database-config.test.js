const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { runInNewContext } = require('node:vm');
const { resolveDatabaseConfig } = require('./database-config');

const base = { POSTGRES_USER: 'mixarr', POSTGRES_PASSWORD: 'test-only', POSTGRES_DB: 'mixarrdb' };

test('constructs a URL whose components round-trip reserved characters', () => {
  const env = { POSTGRES_USER: 'mix@rr:/%', POSTGRES_PASSWORD: 'p@ss:/?#%$ &+\\"\'é', POSTGRES_DB: 'mix/arr?#%' };
  const result = resolveDatabaseConfig(env);
  const url = new URL(result.url);
  assert.equal(decodeURIComponent(url.username), env.POSTGRES_USER);
  assert.equal(decodeURIComponent(url.password), env.POSTGRES_PASSWORD);
  assert.equal(decodeURIComponent(url.pathname.slice(1)), env.POSTGRES_DB);
  assert.equal(url.hostname, 'db');
  assert.equal(url.port, '5432');
  assert.equal(url.search, '?schema=public');
});

test('retains matching legacy URL and pool parameters', () => {
  const url = resolveDatabaseConfig(base).url + '&connection_limit=20&pool_timeout=20';
  assert.equal(resolveDatabaseConfig({ ...base, DATABASE_URL: url }).url, url);
});

test('accepts URL-only external PostgreSQL deployments', () => {
  const url = 'postgres://external:secret@external-db:6543/custom?sslmode=require';
  assert.equal(resolveDatabaseConfig({ DATABASE_URL: url }).url, url);
});

test('rejects absent or blank required settings and mismatched legacy values', () => {
  const url = resolveDatabaseConfig(base).url;
  for (const key of Object.keys(base)) {
    for (const value of [undefined, '']) assert.throws(() => resolveDatabaseConfig({ ...base, [key]: value }), new RegExp(key));
    assert.throws(() => resolveDatabaseConfig({ ...base, [key]: 'different', DATABASE_URL: url }), new RegExp(key));
  }
  for (const [key, value] of [['POSTGRES_HOST', 'other'], ['POSTGRES_PORT', '6543']]) {
    assert.throws(() => resolveDatabaseConfig({ ...base, [key]: value, DATABASE_URL: url }), new RegExp(key));
  }
});

test('rejects malformed URLs without including the supplied URL or password', () => {
  for (const value of ['postgresql://u:secret@bad@db:5432/db', 'postgresql://u:secret#part@db/db',
    'postgresql://u:secret%ZZ@db/db', 'postgresql://u:secret:part@db/db', 'postgresql://u:secret@db/db/extra',
    'postgresql://u:secret\n@db/db', 'postgresql://u:secret@db:bad/db', 'https://u:secret@db/db', 'not-a-url']) {
    assert.throws(() => resolveDatabaseConfig({ DATABASE_URL: value }), (error) => {
      assert.ok(!error.message.includes(value));
      assert.ok(!error.message.includes('secret'));
      return true;
    });
  }
});

test('rejects invalid synthesized host/port and supports IPv6', () => {
  for (const host of ['', 'db/path', 'db:5432', 'db?host=other']) assert.throws(() => resolveDatabaseConfig({ ...base, POSTGRES_HOST: host }));
  for (const port of ['', '0', '65536', '5432/path']) assert.throws(() => resolveDatabaseConfig({ ...base, POSTGRES_PORT: port }));
  assert.equal(resolveDatabaseConfig({ ...base, POSTGRES_HOST: '[::1]' }).metadata.host, '[::1]');
});

test('reads mounted secrets, preserves spaces, rejects conflicting sources and unreadable files', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mixarr-db-test-'));
  try {
    const file = path.join(dir, 'password');
    writeFileSync(file, ' test-only \n');
    const env = { ...base, POSTGRES_PASSWORD: undefined, POSTGRES_PASSWORD_FILE: file };
    assert.equal(decodeURIComponent(new URL(resolveDatabaseConfig(env).url).password), ' test-only ');
    assert.throws(() => resolveDatabaseConfig({ ...env, POSTGRES_PASSWORD: 'conflict' }), /not both/);
    assert.throws(() => resolveDatabaseConfig({ ...env, POSTGRES_PASSWORD_FILE: path.join(dir, 'missing') }), /Cannot read POSTGRES_PASSWORD_FILE/);
    writeFileSync(file, '\n');
    assert.throws(() => resolveDatabaseConfig(env), /POSTGRES_PASSWORD is required/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('entrypoint fails before executing commands and emits no secret on contradiction', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'docker-entrypoint.js'), process.execPath, '-e', 'console.log("COMMAND_RAN")'], {
    env: { ...process.env, ...base, DATABASE_URL: 'postgresql://mixarr:other-test-secret@db:5432/mixarrdb' }, encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /disagrees with POSTGRES_PASSWORD/);
  assert.doesNotMatch(result.stdout + result.stderr, /COMMAND_RAN|test-only|other-test-secret|postgresql:\/\//);
});

test('check-config reports safe metadata without attempting a network connection', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'docker-entrypoint.js'), '--check-config'], {
    env: { ...process.env, ...base, DATABASE_URL: '', POSTGRES_HOST: 'no-such-db' }, encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /"host":"no-such-db"/);
  assert.match(result.stdout, /"passwordConfigured":true/);
  assert.doesNotMatch(result.stdout + result.stderr, /test-only|postgresql:\/\//);
});

test('explicit connection failure reports P1000, disconnects, and never runs migrations', async () => {
  const output = [];
  let disconnected = false;
  const mockProcess = { env: { ...base }, argv: ['node', 'entrypoint', 'sh', '-c', 'startup'] };
  class FakeClient {
    async $connect() { throw { errorCode: 'P1000', message: 'sensitive-test-password' }; }
    async $queryRaw() { assert.fail('Query must not run after failed authentication'); }
    async $disconnect() { disconnected = true; }
  }
  runInNewContext(readFileSync(path.join(__dirname, 'docker-entrypoint.js'), 'utf8'), {
    process: mockProcess,
    console: { log: (value) => output.push(value), error: (value) => output.push(value) },
    require: (name) => {
      if (name === '@prisma/client') return { PrismaClient: FakeClient };
      if (name === 'node:child_process') return { spawn: () => assert.fail('Startup must not run') };
      return require(name);
    },
  });
  await new Promise(setImmediate);
  assert.equal(mockProcess.exitCode, 1);
  assert.ok(disconnected);
  assert.match(output.join('\n'), /P1000/);
  assert.match(output.join('\n'), /Reconcile the role password/);
  assert.doesNotMatch(output.join('\n'), /sensitive-test-password|test-only|postgresql:\/\//);
});
