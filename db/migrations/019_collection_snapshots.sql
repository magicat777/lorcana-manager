-- Daily + per-import collection snapshots so stats can chart size/value over
-- time with rarity/ink/set/type/cost breakdowns, plus import annotations and
-- per-card diffs. Idempotent.

CREATE TABLE IF NOT EXISTS collection_snapshots (
  id           bigserial PRIMARY KEY,
  captured_at  timestamptz NOT NULL DEFAULT now(),
  source       text NOT NULL DEFAULT 'daily'
               CHECK (source IN ('daily','import','manual')),
  import_id    bigint REFERENCES imports(id) ON DELETE SET NULL,
  total_cards  int NOT NULL,
  unique_cards int NOT NULL,
  value_usd    numeric(12,2) NOT NULL,
  breakdown    jsonb NOT NULL     -- {rarity|ink|set|type|cost: {bucket: {c,u,v}}}
);
CREATE INDEX IF NOT EXISTS collection_snapshots_time_idx
  ON collection_snapshots (captured_at);

ALTER TABLE imports ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE imports ADD COLUMN IF NOT EXISTS diff jsonb;  -- {summary, cards:[...]}
