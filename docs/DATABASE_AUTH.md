# PostgreSQL authentication and persistent installations

P1000 means PostgreSQL rejected authentication. It affects every Prisma model, including `track.count()` and `syncSettings.findUnique()`. Retrying queries or changing models cannot fix credentials.

## Configuration flow

| Setting | PostgreSQL container | App / Prisma |
| --- | --- | --- |
| User | Required `POSTGRES_USER` from Compose interpolation | Same explicit mapping |
| Password | Required `POSTGRES_PASSWORD` from Compose interpolation | Same explicit mapping; URL-encoded at startup |
| Database | Required `POSTGRES_DB` from Compose interpolation | Same explicit mapping |
| Host / port | Service `db`, listening on internal port 5432 | `POSTGRES_HOST=db`, `POSTGRES_PORT=5432` |
| Connection URL | Not used | Constructed at startup, or validated against all five settings if supplied |
| Persistent state | `mixarr_db_data` at `/var/lib/postgresql/data` | No credentials are written into the image or generated files |

Previously the example maintained a literal `DATABASE_URL` independently of `POSTGRES_PASSWORD`, while the database used Compose interpolation and the app loaded `.env` directly. Editing only one password or applying a shell/`--env-file` override could send different credentials to the two containers. The old `pg_isready` probe checked availability without verifying authentication.

Both services now explicitly map the same required values. An explicit legacy URL is supported, including pool/SSL query parameters, but a disagreement stops startup. The entrypoint authenticates using Prisma before the compatibility schema commands and passes the same generated URL to those commands and the server. `schema.prisma` still reads `env("DATABASE_URL")`.

Compose interpolation uses the invoking shell before the selected `.env`/`--env-file`. Service `environment` overrides service `env_file`; `docker compose run -e` and override files can still change a particular container. Use one intended deployment directory, project name, and set of `-f`/`--env-file` flags consistently. Unset stale shell variables before deploying. See [Docker interpolation](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/) and [environment precedence](https://docs.docker.com/compose/how-tos/environment-variables/envvars-precedence/).

The app's general `env_file` remains `.env`; selecting `.env.production` with `--env-file` supplies the explicit database mappings to **both** services, but does not change the file used for other app settings. To source all settings from another file, override `app.env_file` as well. This repository has no production env file, Compose override, or configured Docker secrets. Runtime `.env.*` files are excluded from the image so Next.js cannot load build-time production credentials.

For new installations copy `.env.example` and choose a password; blank credentials now fail Compose validation. Single-quote passwords in the env file to preserve literal `$`. Supply the raw password in `POSTGRES_PASSWORD`, not its encoded form. For a custom URL, percent-encode username, password, and database components separately (for example `@` becomes `%40`, `%` becomes `%25`); never encode the entire URL. See [Prisma connection URL requirements](https://docs.prisma.io/docs/orm/v6/overview/databases/postgresql). URL-only external deployments of the image are supported; omit unrelated `POSTGRES_*` settings. For an external database in Compose, adjust/remove the bundled database dependency and override the app's explicit database mappings to match that server.

Custom deployments can mount `POSTGRES_USER_FILE`, `POSTGRES_PASSWORD_FILE`, `POSTGRES_DB_FILE`, or `DATABASE_URL_FILE` for the app entrypoint. A nonempty plain value and its `_FILE` setting are rejected together. Ensure uid 1001 can read app secrets. The bundled Compose file intentionally requires plain `POSTGRES_*`; switching it to Docker secrets requires replacing those mappings in both services and adapting the healthcheck to read the password file. Merely adding a secret mount does not replace existing environment values.

## Check before changing anything

Run commands from the existing deployment directory with the existing Compose project and overrides. Do not start a second stack against a newly named volume. Avoid printing raw `docker inspect`, `docker compose config`, `env`, or connection URLs: they contain secrets.

After pulling and building the fix:

```bash
docker compose --env-file .env config --quiet
docker compose --env-file .env build app
docker compose --env-file .env run --rm --no-deps app --check-config
docker compose --env-file .env run --rm --no-deps app --check-auth
```

`--check-config` prints only host, port, database, user, and whether a password is configured. `--check-auth` uses the actual app image, network, and credentials with Prisma `SELECT 1`; it does not migrate or modify data. `--no-deps` allows diagnostics when an existing database is unhealthy, but the database must already be running. A successful local socket connection alone is not proof that the app password works: local PostgreSQL authentication may use trust.

Inspect roles and database ownership using a known existing administrator (often `mixarr`, not `postgres`, when initialized using the example):

```bash
docker compose exec db psql -U mixarr -d postgres
```

In psql:

```text
\du
\l
```

If `mixarr` is absent, use the original administrator name from your deployment records. Changing `POSTGRES_USER` later does not create a role. Prefer restoring the original user/database settings when they identify the existing Mixarr data. Have a DBA review ownership and grants before introducing a new application role; do not create an empty database to make the error disappear.

## One-time password reconciliation (only if authentication fails)

The official image's initialization settings only affect an **empty** data directory. Recreating the container with a new `POSTGRES_PASSWORD` leaves the stored role password unchanged. See the [official PostgreSQL image documentation](https://hub.docker.com/_/postgres).

1. Preserve the existing volume and your normal database backup. Identify the intended secret and the existing role/database. Stop the app while reconciling to avoid authentication failures from its workers: `docker compose stop app`.
2. Use the administrator psql session above. If local access is restricted, use your existing administrative authentication method; do not enable `trust` or weaken `pg_hba.conf`.
3. For an existing `mixarr` role, enter the following psql command and provide the intended raw `POSTGRES_PASSWORD` at its hidden prompts:

   ```text
   \password mixarr
   \q
   ```

   `\password` changes that role's password without placing plaintext in shell history or a SQL command. It preserves all tables and data. Do not put passwords in command-line arguments or log an `ALTER ROLE` containing plaintext. Password rotation affects every other client using this role; coordinate their secrets too.
4. Set `POSTGRES_*` in the deployment environment to those intended values. Remove the redundant `DATABASE_URL` (recommended), or correct its encoded components. Do not replace an existing working password with the example's blank value. If you lack administrative access, retain the volume and recover the original credentials or get administrator assistance.
5. Recreate the services with their updated environment, retaining all named volumes:

   ```bash
   docker compose --env-file .env up -d --build
   docker compose --env-file .env run --rm --no-deps app --check-auth
   docker compose --env-file .env run --rm --no-deps app --check-queries
   ```

The healthcheck authenticates to `db:5432` using the DB container's current settings. An unhealthy database after rotation can mean its container still has the old environment; recreate that service with the same volume and intended settings. The app preflight independently authenticates its own settings.

## Schema and dashboard verification

Docker installations historically use `prisma db push`, not `migrate deploy`. This fix preserves the existing order: preflight SQL, `db push --skip-generate`, storage-safety SQL, identity backfill, request-limit backfill, then the server. No reset or accept-data-loss flags are used. Review any schema warning and take a backup before deciding how to handle it.

`--check-queries` performs `track.count()` and a `syncSettings.findUnique()` lookup for a reserved probe user; a null result is valid. It makes no writes. After startup, run the installed Prisma CLI through the entrypoint (so it receives the generated URL):

```bash
docker compose run --rm --no-deps app ./node_modules/.bin/prisma validate
docker compose run --rm --no-deps app ./node_modules/.bin/prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code
```

An empty diff confirms the schema matches. `prisma migrate status` may report unapplied migrations/no history on a historical `db push` installation; that is not an authentication failure. Do not switch such a database to `migrate deploy` or mark migrations applied blindly. Baseline adoption is a separate migration task.

Open the dashboard at `http://localhost:3030`, confirm authenticated library/dashboard requests work, and check that P1000 is absent from new logs. Healthy existing installations need no password change or new SQL migration for this fix. There is no reason to delete volumes, reset the schema, drop roles, or drop databases to repair authentication.
