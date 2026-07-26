# Use an official Node.js runtime as a parent image
FROM node:20-bookworm-slim AS base

# Install dependencies only when needed
FROM base AS deps
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json package-lock.json* yarn.lock* pnpm-lock.yaml* ./
COPY prisma ./prisma
RUN \
  if [ -f yarn.lock ]; then yarn --frozen-lockfile; \
  elif [ -f package-lock.json ]; then npm ci; \
  elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm i --frozen-lockfile; \
  else echo "Lockfile not found." && npm i; \
  fi

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
ARG NEXT_PUBLIC_APP_VERSION
ENV NODE_OPTIONS="--max-old-space-size=4096"
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Next.js build
RUN \
  if [ -f yarn.lock ]; then yarn run build; \
  elif [ -f package-lock.json ]; then npm run build; \
  elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm run build; \
  else npm run build; \
  fi

# Keep the migration CLI in the immutable image without carrying compilers,
# linters, and the rest of the development dependency tree into production.
FROM deps AS production-deps
RUN npm prune --omit=dev

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app
ARG TARGETARCH
ARG NEXT_PUBLIC_APP_VERSION=2.4.16
LABEL org.opencontainers.image.title="Mixarr" \
      org.opencontainers.image.version="2.4.16" \
      org.opencontainers.image.description="Mixarr storage-safe large-library playlist engine"

RUN apt-get update && apt-get install -y openssl ffmpeg aubio-tools python3 python3-venv && rm -rf /var/lib/apt/lists/*
RUN if [ "${TARGETARCH:-$(dpkg --print-architecture)}" = "amd64" ]; then \
      python3 -m venv /opt/essentia && \
      /opt/essentia/bin/pip install --no-cache-dir --upgrade pip && \
      /opt/essentia/bin/pip install --no-cache-dir "numpy<2" essentia==2.1b6.dev1110 && \
      /opt/essentia/bin/python -c "import numpy; import essentia.standard as es; print('Essentia ready with NumPy', numpy.__version__)"; \
    else \
      echo "Skipping Essentia install for TARGETARCH=${TARGETARCH:-$(dpkg --print-architecture)}"; \
    fi

ENV NODE_ENV=production
ENV DOCKER=1
ENV LOCAL_BPM_ESSENTIA_PYTHON=/opt/essentia/bin/python
ENV MIXARR_CONFIG_DIR=/config
ENV MIXARR_DATA_DIR=/data
ENV MIXARR_CACHE_DIR=/data/cache
ENV MIXARR_TEMP_DIR=/data/temp
ENV MIXARR_ARTWORK_DIR=/data/artwork
ENV MIXARR_BACKUP_DIR=/data/backups
ENV MIXARR_LOG_DIR=/data/logs
ENV LOCAL_BPM_TEMP_DIR=/data/temp/bpm
ENV LOCAL_AUDIO_FEATURE_TEMP_DIR=/data/temp/audio-features
# Uncomment the following line in case you want to disable telemetry during runtime.
# ENV NEXT_TELEMETRY_DISABLED=1

RUN groupadd --system --gid 1001 nodejs
RUN useradd --system --uid 1001 --gid 1001 nextjs
RUN mkdir -p /config/database /config/migrations /data/cache /data/temp /data/artwork /data/backups /data/exports /data/jobs /data/scans /data/logs \
    && chown -R nextjs:nodejs /config /data

COPY --from=builder /app/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

# The Prisma CLI is used for the compatibility db-push sequence. Bundle it in
# the immutable image; `npx --yes` downloaded about 230 MB into /tmp on every
# fresh v2.4.14 container and was a confirmed writable-layer defect.
COPY --from=production-deps --chown=nextjs:nodejs /app/node_modules ./node_modules

VOLUME ["/config", "/data"]

USER nextjs

EXPOSE 3000

ENV PORT=3000
# set hostname to localhost
ENV HOSTNAME="0.0.0.0"

# Existing installations historically used `db push`, so required identity fields
# must be added and populated before Prisma reconciles the final schema. The
# post-push step performs the same idempotent data backfill as the v2.1.1 migration.
CMD ["sh", "-c", "./node_modules/.bin/prisma db execute --schema prisma/schema.prisma --file prisma/db-push-preflight.sql && ./node_modules/.bin/prisma db push --skip-generate && ./node_modules/.bin/prisma db execute --schema prisma/schema.prisma --file prisma/migrations/20260803010000_storage_safety_v2415/migration.sql && ./node_modules/.bin/prisma db execute --schema prisma/schema.prisma --file prisma/db-push-v2.1.1-backfill.sql && node server.js"]
