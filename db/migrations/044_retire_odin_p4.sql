-- Retire the ODIN-authored P4 rows (2026-10-14): Lorcast added a real P4
-- set (the 2026-10-14 seed run hit sets_code_key on 'P4'), and its
-- collector numbers 9/10/11 are exactly our three promos. Per mig 038's
-- own header: migrate collection counts to the Lorcast crd_* rows and
-- retire the odin_* rows. Mig 038's inserts are now gated so it cannot
-- re-create them.
--
-- Two-phase by design (migrations re-run on every apply.sh):
--   A) free the code so the seed job can insert Lorcast's P4;
--   B) once the crd_* rows exist, merge counts/log and delete odin rows.
-- Before the seed lands, B matches nothing and is a no-op. Idempotent.

-- Phase A: free the 'P4' code.
UPDATE sets SET code = 'P4-ODIN', updated_at = now()
WHERE id = 'set_odin_p4' AND code = 'P4';

-- Phase B: pair odin promos with their Lorcast P4 rows by collector number.
-- (Only collection + collection_log reference these ids — verified 2026-10-14.)
WITH pairs AS (
  SELECT o.id AS odin_id, l.id AS crd_id
  FROM cards o
  JOIN sets os ON os.id = o.set_id AND os.id = 'set_odin_p4'
  JOIN sets ls ON ls.code = 'P4' AND ls.id <> 'set_odin_p4'
  JOIN cards l ON l.set_id = ls.id
    AND l.collector_number = o.collector_number
    AND lower(l.full_name) = lower(o.full_name)
)
INSERT INTO collection (card_id, qty_normal, qty_foil)
SELECT p.crd_id, c.qty_normal, c.qty_foil
FROM pairs p JOIN collection c ON c.card_id = p.odin_id
ON CONFLICT (card_id) DO UPDATE SET
  qty_normal = collection.qty_normal + EXCLUDED.qty_normal,
  qty_foil = collection.qty_foil + EXCLUDED.qty_foil;

WITH pairs AS (
  SELECT o.id AS odin_id, l.id AS crd_id
  FROM cards o
  JOIN sets os ON os.id = o.set_id AND os.id = 'set_odin_p4'
  JOIN sets ls ON ls.code = 'P4' AND ls.id <> 'set_odin_p4'
  JOIN cards l ON l.set_id = ls.id
    AND l.collector_number = o.collector_number
    AND lower(l.full_name) = lower(o.full_name)
)
UPDATE collection_log SET card_id = p.crd_id
FROM pairs p WHERE collection_log.card_id = p.odin_id;

-- Aliases must survive the set deletion: repoint anything still aimed at
-- the odin set to Lorcast's P4 (the seed's own upsert usually did this
-- already for 'p4'; 'promo set 4' may not match their name).
UPDATE set_aliases SET set_id = (SELECT id FROM sets WHERE code = 'P4' LIMIT 1)
WHERE set_id = 'set_odin_p4'
  AND EXISTS (SELECT 1 FROM sets WHERE code = 'P4' AND id <> 'set_odin_p4');

-- Delete the migrated odin cards, then the set once it's empty.
DELETE FROM collection WHERE card_id LIKE 'odin\_p4\_%'
  AND EXISTS (SELECT 1 FROM sets WHERE code = 'P4' AND id <> 'set_odin_p4');
DELETE FROM cards WHERE set_id = 'set_odin_p4'
  AND EXISTS (SELECT 1 FROM sets WHERE code = 'P4' AND id <> 'set_odin_p4');
DELETE FROM sets WHERE id = 'set_odin_p4'
  AND NOT EXISTS (SELECT 1 FROM cards WHERE set_id = 'set_odin_p4');
