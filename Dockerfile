# Pazzera backend — production container for Railway
# Build context: repo root

FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Build deps for better-sqlite3 native compilation
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Install server deps
COPY server/package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Copy source and build TypeScript
COPY server/tsconfig.json ./
COPY server/src ./src
COPY server/scripts ./scripts
RUN npm install --no-save typescript@5.6 && npx tsc

# ---------- production runtime ----------
FROM node:20-bookworm-slim

WORKDIR /app

# Runtime deps for better-sqlite3 (still needs libstdc++)
RUN apt-get update && apt-get install -y libstdc++6 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/scripts ./scripts

# Persistent data dirs
RUN mkdir -p /app/data /app/tracks
VOLUME ["/app/data"]

ENV NODE_ENV=production
ENV PORT=3001
ENV DB_PATH=/app/data/pazzera.db
ENV TRACKS_DIR=/app/tracks

EXPOSE 3001

CMD ["node", "dist/index.js"]
