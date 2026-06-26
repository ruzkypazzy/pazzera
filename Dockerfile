# Pazzera backend — Fly.io deploy
# Build context: repo root, but source lives in server/

FROM node:20-bookworm-slim

WORKDIR /app

# Install build deps for better-sqlite3 native build
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy server package files first for better caching
COPY server/package*.json ./
# Generate lockfile on the fly so npm ci works, or use npm install if no lockfile
RUN npm install --omit=dev --no-audit --no-fund || npm install --omit=dev

# Copy source
COPY server/tsconfig.json ./
COPY server/src ./src
COPY server/scripts ./scripts

# Build TypeScript
RUN npm install --no-save typescript@5.6 tsx@4.19 && npm run build

# Persistent volume for SQLite DB and tracks
RUN mkdir -p /app/data /app/tracks
VOLUME ["/app/data"]

ENV NODE_ENV=production
ENV PORT=3001
ENV DB_PATH=/app/data/pazzera.db
ENV TRACKS_DIR=/app/tracks

EXPOSE 3001

CMD ["node", "dist/index.js"]