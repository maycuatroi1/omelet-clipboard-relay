# syntax=docker/dockerfile:1.7

# Stage 1: verify the service (typecheck, lint, test) before it is allowed to ship.
FROM oven/bun:latest AS verify

WORKDIR /app

# Install deps first so the verify layer is cacheable.
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

COPY tsconfig.json biome.json ./
COPY src ./src
COPY test ./test

RUN bun run typecheck
RUN bun run lint
RUN bun test

# Stage 2: runtime image - only src/ and the lockfile, no dev tooling.
FROM oven/bun:latest AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production

COPY tsconfig.json ./
COPY src ./src

# Non-root user.
RUN addgroup --system --gid 1001 bunrel \
 && adduser --system --uid 1001 --ingroup bunrel --home /app bunrel \
 && chown -R bunrel:bunrel /app

USER bunrel

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "const r = await fetch('http://127.0.0.1:'+(process.env.PORT ?? 3000)+'/health'); if (!r.ok) process.exit(1); const b = await r.json(); if (b.status !== 'ok') process.exit(1);"

CMD ["bun", "run", "src/index.ts"]
