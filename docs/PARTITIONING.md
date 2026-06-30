# Database Partitioning Strategy

> Phase 2 design — addresses the playback-event ingestion hot path and the long-tail growth of `Stream` / `PlaybackTick` / `LedgerEntry`.

## TL;DR

| Table | Strategy | Rationale | Initial partitions |
|---|---|---|---|
| `Stream` | RANGE by `startedAt` (monthly) | Time-series; old data is read-only, queried by month, easy to archive/drop | 12 forward, 0 backfill |
| `PlaybackTick` | RANGE by `createdAt` (monthly) | Same as Stream — append-only, huge volume | 12 forward |
| `LedgerEntry` | RANGE by `createdAt` (quarterly) | Auditable financial data, lower volume, longer retention | 8 forward |
| `AgentLog` | RANGE by `createdAt` (monthly) | Append-only observability | 12 forward |
| `OtpCode` | None — kept small by aggressive TTL job | Tiny, short-lived | — |

All other tables (`User`, `Song`, `Payment`, `RoyaltyRecipient`, etc.) are NOT partitioned at this stage — their row counts are bounded by the catalog and user base, not by user actions.

---

## 1. Why partition

At hackathon scale this looks overkill. But:

- **PlaybackTick grows at ~1 row per 5 seconds of listening per stream.** A single 3-min song = ~36 ticks. 10k DAU streaming 5 songs/day = ~1.8M ticks/day = ~54M/month. Postgres can handle this but unpartitioned, indexes bloat fast.
- **Streams are inherently temporal.** Most queries (analytics, admin, anti-fraud) are time-windowed: "streams in the last 30 days", "fraud patterns this week". Partition pruning makes these nearly free.
- **Old partitions can be detached cheaply.** When the demo period is over, dropping a partition is O(1); deleting rows is O(N).
- **Compliance/retention.** Some ledger data must be retained for years; partition isolation makes "hot vs cold" storage decisions tractable later.

## 2. Concrete DDL

```sql
-- Streams: monthly RANGE partitions
CREATE TABLE stream_default PARTITION OF "Stream" DEFAULT;

CREATE TABLE stream_2026_07 PARTITION OF "Stream"
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE stream_2026_08 PARTITION OF "Stream"
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
-- ... pre-create 12 months ahead via cron

-- PlaybackTick: monthly RANGE on createdAt
CREATE TABLE playback_tick_default PARTITION OF "PlaybackTick" DEFAULT;
CREATE TABLE playback_tick_2026_07 PARTITION OF "PlaybackTick"
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
-- ... 12 forward

-- LedgerEntry: quarterly
CREATE TABLE ledger_default PARTITION OF "LedgerEntry" DEFAULT;
CREATE TABLE ledger_2026_q3 PARTITION OF "LedgerEntry"
  FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
-- ... 8 forward

-- AgentLog: monthly
CREATE TABLE agent_log_default PARTITION OF "AgentLog" DEFAULT;
CREATE TABLE agent_log_2026_07 PARTITION OF "AgentLog"
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
```

## 3. Prisma interop

Prisma does NOT natively generate partitioned tables. The migration workflow:

1. Define tables normally in `schema.prisma` (as we have).
2. First migration creates the unpartitioned table.
3. A second, **raw-SQL** migration (`.sql` file under `packages/db/prisma/migrations/`) converts the table to partitioned:

```sql
-- packages/db/prisma/migrations/20260701000000_partition_streams/migration.sql

-- Step 1: rename existing
ALTER TABLE "Stream" RENAME TO "Stream_unpartitioned";

-- Step 2: create partitioned parent (same columns)
CREATE TABLE "Stream" (
  id text PRIMARY KEY,
  -- ... all columns
  "startedAt" timestamp(3) NOT NULL DEFAULT now()
) PARTITION BY RANGE ("startedAt");

-- Step 3: forward partitions
CREATE TABLE stream_2026_07 PARTITION OF "Stream"
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE stream_2026_08 PARTITION OF "Stream"
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
-- ... 12 forward

CREATE TABLE stream_default PARTITION OF "Stream" DEFAULT;

-- Step 4: copy data
INSERT INTO "Stream" SELECT * FROM "Stream_unpartitioned";

-- Step 5: drop old
DROP TABLE "Stream_unpartitioned";
```

4. A nightly maintenance cron (already in `packages/queue/src/queues.ts` as `maintenance` queue) creates new partitions 3 months ahead.

## 4. Foreign key implications

**Foreign keys from partitioned tables to non-partitioned tables are fine** (e.g. `Stream.userId → User.id`).

**Foreign keys from non-partitioned tables TO partitioned tables are problematic** in older Postgres versions. We avoid this:
- `User` does NOT reference `Stream` or `PlaybackTick` (no backref needed).
- `Payment.streamId` → `Stream.id`: Payment is created AFTER the Stream exists, so the constraint can be a regular index lookup. We **drop** the FK and rely on application-level enforcement + the unique index `(streamId)`.

## 5. Index strategy on partitioned tables

Primary indexes (defined in `schema.prisma`) automatically become indexes on each partition. Postgres 11+ propagates them.

For cross-partition queries (rare), we add BRIN indexes on `startedAt` / `createdAt` for cheap range scans over huge partitions:

```sql
CREATE INDEX playback_tick_created_brin
  ON "PlaybackTick" USING BRIN ("createdAt") WITH (pages_per_range = 32);
```

## 6. Operational tools

- **Pre-create partitions**: nightly maintenance job calls `create_partitions.sql` template.
- **Retention**: legal team decides (5 years for ledger, 13 months for ticks, 7 years for streams — typical). Retention is `DETACH PARTITION` + `DROP TABLE` — instant.
- **Monitoring**: pg_partitions / pg_stat_user_tables tells you partition bloat.
- **Backup**: `pg_dump` works on partitioned tables; `pgBackRest` handles them natively.

## 7. Why NOT partition everything

- Catalog tables (`User`, `Song`, `Wallet`) are small and bounded.
- Partitioning adds operational overhead (cron, monitoring) that has no payoff at this row count.
- Adding a partition later is straightforward; we'd rather have a working system today than a perfectly pre-partitioned one.