-- Two hardening items from the 2026-08-18 practice-session review:
--
-- 1. Corpus quarantine: duels.ink's own tracking sometimes drops sequences
--    (unmarked undos in copy-paste exports, missed lore effects). A log that
--    fails ingest validation is stored but excluded from the replay corpus
--    with a reason — never silently admitted, never silently discarded.
--
-- 2. event_type as a first-class filter (practice | sanctioned | casual):
--    practice bot games must not pollute cut-list/MVP evidence or the meta
--    stats once sanctioned play with the same deck begins. Backfills existing
--    duels.ink events as practice. Idempotent.

ALTER TABLE duels_game_logs ADD COLUMN IF NOT EXISTS corpus_excluded boolean NOT NULL DEFAULT false;
ALTER TABLE duels_game_logs ADD COLUMN IF NOT EXISTS exclude_reason text;

ALTER TABLE events ADD COLUMN IF NOT EXISTS event_type text NOT NULL DEFAULT 'sanctioned';
DO $$ BEGIN
  ALTER TABLE events ADD CONSTRAINT events_event_type_check
    CHECK (event_type IN ('sanctioned', 'practice', 'casual'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

UPDATE events SET event_type = 'practice'
WHERE store ILIKE '%duels%' AND event_type = 'sanctioned';
