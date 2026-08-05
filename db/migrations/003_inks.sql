-- Dual-ink support (set 13+ cards can have two inks). `ink` keeps the primary
-- ink as reported by Lorcast; `inks` holds all of them and is what filters use.
-- Backfill from the raw Lorcast payload; idempotent.

ALTER TABLE cards ADD COLUMN IF NOT EXISTS inks text[];

UPDATE cards
SET inks = CASE
  WHEN jsonb_typeof(raw->'inks') = 'array'
    THEN (SELECT array_agg(x) FROM jsonb_array_elements_text(raw->'inks') AS x)
  WHEN ink IS NOT NULL THEN ARRAY[ink]
  ELSE NULL
END
WHERE inks IS NULL;

CREATE INDEX IF NOT EXISTS cards_inks_idx ON cards USING gin (inks);
