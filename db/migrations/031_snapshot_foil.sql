-- Foil copies per collection snapshot, for the foils line on the
-- collection-size-over-time charts. NULL on rows captured before this
-- column existed — history can't be reconstructed, the series starts
-- when the column ships. Idempotent.

ALTER TABLE collection_snapshots ADD COLUMN IF NOT EXISTS total_foil integer;

-- Seed the newest snapshot with the current foil count so the series has a
-- first point immediately (collection is unchanged since that capture).
UPDATE collection_snapshots
SET total_foil = (SELECT COALESCE(sum(qty_foil), 0) FROM collection)
WHERE id = (SELECT max(id) FROM collection_snapshots)
  AND total_foil IS NULL;
