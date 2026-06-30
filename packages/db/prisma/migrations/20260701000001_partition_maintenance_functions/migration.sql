-- ============================================================
-- Partition maintenance: a function that creates the next N partitions
-- for each partitioned table. Called by a BullMQ maintenance cron
-- (Phase 7) once per day.
-- ============================================================

CREATE OR REPLACE FUNCTION ensure_stream_partitions(months_ahead int DEFAULT 3)
RETURNS void AS $$
DECLARE
  start_month date := date_trunc('month', now())::date;
  i int;
  pstart date;
  pend date;
  pname text;
BEGIN
  FOR i IN 1..months_ahead LOOP
    pstart := start_month + (i || ' months')::interval;
    pend := pstart + interval '1 month';
    pname := 'Stream_' || to_char(pstart, 'YYYY_MM');
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = lower(pname)) THEN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF "Stream" FOR VALUES FROM (%L) TO (%L)',
        pname, pstart, pend
      );
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ensure_playback_tick_partitions(months_ahead int DEFAULT 3)
RETURNS void AS $$
DECLARE
  start_month date := date_trunc('month', now())::date;
  i int;
  pstart date;
  pend date;
  pname text;
BEGIN
  FOR i IN 1..months_ahead LOOP
    pstart := start_month + (i || ' months')::interval;
    pend := pstart + interval '1 month';
    pname := 'PlaybackTick_' || to_char(pstart, 'YYYY_MM');
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = lower(pname)) THEN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF "PlaybackTick" FOR VALUES FROM (%L) TO (%L)',
        pname, pstart, pend
      );
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ensure_ledger_partitions(quarters_ahead int DEFAULT 2)
RETURNS void AS $$
DECLARE
  start_q date := date_trunc('quarter', now())::date;
  i int;
  pstart date;
  pend date;
  pname text;
BEGIN
  FOR i IN 1..quarters_ahead LOOP
    pstart := start_q + (i * 3 || ' months')::interval;
    pend := pstart + interval '3 months';
    pname := 'LedgerEntry_' || to_char(pstart, 'YYYY') || '_q' || to_char(pstart, 'Q');
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = lower(pname)) THEN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF "LedgerEntry" FOR VALUES FROM (%L) TO (%L)',
        pname, pstart, pend
      );
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ensure_agent_log_partitions(months_ahead int DEFAULT 3)
RETURNS void AS $$
DECLARE
  start_month date := date_trunc('month', now())::date;
  i int;
  pstart date;
  pend date;
  pname text;
BEGIN
  FOR i IN 1..months_ahead LOOP
    pstart := start_month + (i || ' months')::interval;
    pend := pstart + interval '1 month';
    pname := 'AgentLog_' || to_char(pstart, 'YYYY_MM');
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = lower(pname)) THEN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF "AgentLog" FOR VALUES FROM (%L) TO (%L)',
        pname, pstart, pend
      );
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;