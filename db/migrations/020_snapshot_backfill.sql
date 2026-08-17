-- Backfill collection_snapshots from the imports audit trail so the history
-- chart covers the weeks before daily snapshots existed. Only total copies
-- (and, for replace imports, unique cards) can be reconstructed — per-card
-- state wasn't recorded, so value/breakdown stay NULL on backfilled rows and
-- those charts simply skip them. Idempotent via NOT EXISTS.

ALTER TABLE collection_snapshots ALTER COLUMN unique_cards DROP NOT NULL;
ALTER TABLE collection_snapshots ALTER COLUMN value_usd    DROP NOT NULL;
ALTER TABLE collection_snapshots ALTER COLUMN breakdown    DROP NOT NULL;

INSERT INTO collection_snapshots
    (captured_at, source, import_id, total_cards, unique_cards, value_usd, breakdown)
SELECT i.uploaded_at, 'import', i.id,
       (i.summary->>'qty_after')::int,
       -- replace zeroes then upserts every counted card, so added+updated
       -- IS the unique count afterwards; merge can't tell us the total.
       CASE WHEN i.mode = 'replace'
            THEN (i.summary->>'added')::int + (i.summary->>'updated')::int END,
       NULL, NULL
FROM imports i
WHERE NOT i.dry_run
  AND i.summary ? 'qty_after'
  AND NOT EXISTS (SELECT 1 FROM collection_snapshots cs WHERE cs.import_id = i.id);
