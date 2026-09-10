-- Per-card collection audit trail (2026-09-10): every count change with its
-- source — an import (import_id links the file/note) or a manual edit
-- (webui/mcp/api). Built to answer "when did I supposedly get 4 Kangas":
-- imports were already reconstructable from imports.diff (mig 019); manual
-- +/- edits on the card page left NO trace until this table. Idempotent.
--
-- Backfill: applied (non-dry) imports' stored diffs become log rows at the
-- import's upload time — so history reaches back to the first stored diff
-- (2026-08-04). Caveats: diffs cap at 500 cards per import (largest moves
-- kept), and manual edits before this migration are unrecoverable.

CREATE TABLE IF NOT EXISTS collection_log (
  id             bigserial PRIMARY KEY,
  card_id        text NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  source         text NOT NULL,   -- import | webui | mcp | api
  import_id      bigint REFERENCES imports(id) ON DELETE SET NULL,
  before_normal  int NOT NULL,
  before_foil    int NOT NULL,
  after_normal   int NOT NULL,
  after_foil     int NOT NULL,
  at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS collection_log_card_idx
  ON collection_log (card_id, at DESC);
CREATE INDEX IF NOT EXISTS collection_log_import_idx
  ON collection_log (import_id);

INSERT INTO collection_log (card_id, source, import_id, before_normal,
                            before_foil, after_normal, after_foil, at)
SELECT c->>'card_id', 'import', i.id,
       (c->>'before_normal')::int, (c->>'before_foil')::int,
       (c->>'after_normal')::int, (c->>'after_foil')::int, i.uploaded_at
FROM imports i
CROSS JOIN LATERAL jsonb_array_elements(i.diff->'cards') AS c
WHERE NOT i.dry_run AND i.diff IS NOT NULL
  AND c->>'card_id' IN (SELECT id FROM cards)
  AND NOT EXISTS (SELECT 1 FROM collection_log cl WHERE cl.import_id = i.id);
