# Pazzera backend — Fly.io deploy
FROM node:20-bookworm-slim

WORKDIR /app

# Install build deps for better-sqlite3 native build
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy package files first for better caching
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts

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