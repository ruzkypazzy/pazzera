-- ============================================================
-- Migration: partition hot tables (Stream, PlaybackTick, LedgerEntry, AgentLog)
-- Created: Phase 2
--
-- Strategy: see docs/PARTITIONING.md
--   Stream         → monthly RANGE on startedAt
--   PlaybackTick   → monthly RANGE on createdAt
--   LedgerEntry    → quarterly RANGE on createdAt
--   AgentLog       → monthly RANGE on createdAt
--
-- Pre-creates 12 months (Stream / PlaybackTick / AgentLog) and
-- 8 quarters (LedgerEntry) of forward partitions.
--
-- Foreign keys from partitioned tables to non-partitioned tables
-- (Stream.userId → User.id, etc.) are preserved.
-- Foreign keys from non-partitioned tables TO partitioned tables
-- are NOT present in our schema (verified in schema.prisma).
-- ============================================================

-- ─── Stream ────────────────────────────────────────────────────────
ALTER TABLE "Stream" RENAME TO "Stream_old";
CREATE TABLE "Stream" (LIKE "Stream_old" INCLUDING ALL)
  PARTITION BY RANGE ("startedAt");

CREATE TABLE "Stream_2026_07" PARTITION OF "Stream"
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE "Stream_2026_08" PARTITION OF "Stream"
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE "Stream_2026_09" PARTITION OF "Stream"
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE "Stream_2026_10" PARTITION OF "Stream"
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE "Stream_2026_11" PARTITION OF "Stream"
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE "Stream_2026_12" PARTITION OF "Stream"
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE "Stream_2027_01" PARTITION OF "Stream"
  FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
CREATE TABLE "Stream_2027_02" PARTITION OF "Stream"
  FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');
CREATE TABLE "Stream_2027_03" PARTITION OF "Stream"
  FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');
CREATE TABLE "Stream_2027_04" PARTITION OF "Stream"
  FOR VALUES FROM ('2027-04-01') TO ('2027-05-01');
CREATE TABLE "Stream_2027_05" PARTITION OF "Stream"
  FOR VALUES FROM ('2027-05-01') TO ('2027-06-01');
CREATE TABLE "Stream_2027_06" PARTITION OF "Stream"
  FOR VALUES FROM ('2027-06-01') TO ('2027-07-01');
CREATE TABLE "Stream_default" PARTITION OF "Stream" DEFAULT;

INSERT INTO "Stream" SELECT * FROM "Stream_old";
DROP TABLE "Stream_old";

-- BRIN index for fast time-range scans across many partitions
CREATE INDEX "Stream_startedAt_brin" ON "Stream"
  USING BRIN ("startedAt") WITH (pages_per_range = 32);

-- ─── PlaybackTick ─────────────────────────────────────────────────
ALTER TABLE "PlaybackTick" RENAME TO "PlaybackTick_old";
CREATE TABLE "PlaybackTick" (LIKE "PlaybackTick_old" INCLUDING ALL)
  PARTITION BY RANGE ("createdAt");

CREATE TABLE "PlaybackTick_2026_07" PARTITION OF "PlaybackTick"
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE "PlaybackTick_2026_08" PARTITION OF "PlaybackTick"
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE "PlaybackTick_2026_09" PARTITION OF "PlaybackTick"
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE "PlaybackTick_2026_10" PARTITION OF "PlaybackTick"
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE "PlaybackTick_2026_11" PARTITION OF "PlaybackTick"
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE "PlaybackTick_2026_12" PARTITION OF "PlaybackTick"
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE "PlaybackTick_2027_01" PARTITION OF "PlaybackTick"
  FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
CREATE TABLE "PlaybackTick_2027_02" PARTITION OF "PlaybackTick"
  FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');
CREATE TABLE "PlaybackTick_2027_03" PARTITION OF "PlaybackTick"
  FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');
CREATE TABLE "PlaybackTick_2027_04" PARTITION OF "PlaybackTick"
  FOR VALUES FROM ('2027-04-01') TO ('2027-05-01');
CREATE TABLE "PlaybackTick_2027_05" PARTITION OF "PlaybackTick"
  FOR VALUES FROM ('2027-05-01') TO ('2027-06-01');
CREATE TABLE "PlaybackTick_2027_06" PARTITION OF "PlaybackTick"
  FOR VALUES FROM ('2027-06-01') TO ('2027-07-01');
CREATE TABLE "PlaybackTick_default" PARTITION OF "PlaybackTick" DEFAULT;

INSERT INTO "PlaybackTick" SELECT * FROM "PlaybackTick_old";
DROP TABLE "PlaybackTick_old";

CREATE INDEX "PlaybackTick_createdAt_brin" ON "PlaybackTick"
  USING BRIN ("createdAt") WITH (pages_per_range = 32);

-- ─── LedgerEntry (quarterly) ──────────────────────────────────────
ALTER TABLE "LedgerEntry" RENAME TO "LedgerEntry_old";
CREATE TABLE "LedgerEntry" (LIKE "LedgerEntry_old" INCLUDING ALL)
  PARTITION BY RANGE ("createdAt");

CREATE TABLE "LedgerEntry_2026_q3" PARTITION OF "LedgerEntry"
  FOR VALUES FROM ('2026-07-01') TO ('2026-10-01');
CREATE TABLE "LedgerEntry_2026_q4" PARTITION OF "LedgerEntry"
  FOR VALUES FROM ('2026-10-01') TO ('2027-01-01');
CREATE TABLE "LedgerEntry_2027_q1" PARTITION OF "LedgerEntry"
  FOR VALUES FROM ('2027-01-01') TO ('2027-04-01');
CREATE TABLE "LedgerEntry_2027_q2" PARTITION OF "LedgerEntry"
  FOR VALUES FROM ('2027-04-01') TO ('2027-07-01');
CREATE TABLE "LedgerEntry_2027_q3" PARTITION OF "LedgerEntry"
  FOR VALUES FROM ('2027-07-01') TO ('2027-10-01');
CREATE TABLE "LedgerEntry_2027_q4" PARTITION OF "LedgerEntry"
  FOR VALUES FROM ('2027-10-01') TO ('2028-01-01');
CREATE TABLE "LedgerEntry_2028_q1" PARTITION OF "LedgerEntry"
  FOR VALUES FROM ('2028-01-01') TO ('2028-04-01');
CREATE TABLE "LedgerEntry_2028_q2" PARTITION OF "LedgerEntry"
  FOR VALUES FROM ('2028-04-01') TO ('2028-07-01');
CREATE TABLE "LedgerEntry_default" PARTITION OF "LedgerEntry" DEFAULT;

INSERT INTO "LedgerEntry" SELECT * FROM "LedgerEntry_old";
DROP TABLE "LedgerEntry_old";

-- ─── AgentLog (monthly) ───────────────────────────────────────────
ALTER TABLE "AgentLog" RENAME TO "AgentLog_old";
CREATE TABLE "AgentLog" (LIKE "AgentLog_old" INCLUDING ALL)
  PARTITION BY RANGE ("createdAt");

CREATE TABLE "AgentLog_2026_07" PARTITION OF "AgentLog"
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE "AgentLog_2026_08" PARTITION OF "AgentLog"
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE "AgentLog_2026_09" PARTITION OF "AgentLog"
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE "AgentLog_2026_10" PARTITION OF "AgentLog"
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE "AgentLog_2026_11" PARTITION OF "AgentLog"
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE "AgentLog_2026_12" PARTITION OF "AgentLog"
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE "AgentLog_2027_01" PARTITION OF "AgentLog"
  FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
CREATE TABLE "AgentLog_2027_02" PARTITION OF "AgentLog"
  FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');
CREATE TABLE "AgentLog_2027_03" PARTITION OF "AgentLog"
  FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');
CREATE TABLE "AgentLog_2027_04" PARTITION OF "AgentLog"
  FOR VALUES FROM ('2027-04-01') TO ('2027-05-01');
CREATE TABLE "AgentLog_2027_05" PARTITION OF "AgentLog"
  FOR VALUES FROM ('2027-05-01') TO ('2027-06-01');
CREATE TABLE "AgentLog_2027_06" PARTITION OF "AgentLog"
  FOR VALUES FROM ('2027-06-01') TO ('2027-07-01');
CREATE TABLE "AgentLog_default" PARTITION OF "AgentLog" DEFAULT;

INSERT INTO "AgentLog" SELECT * FROM "AgentLog_old";
DROP TABLE "AgentLog_old";