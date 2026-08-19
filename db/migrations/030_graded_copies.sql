-- Collector grading lifecycle: one row per PHYSICAL copy in the grading
-- pipeline (collection counts stay aggregate). Copies with status
-- submitted/graded are excluded from every deck-building availability
-- computation — a slabbed card can't be registered in a deck. status='raw'
-- is a pre-submission earmark: tracked, but still playable until submitted.
-- ODIN stays authoritative across raw -> submitted -> graded. Idempotent.

CREATE TABLE IF NOT EXISTS graded_copies (
  id             bigserial PRIMARY KEY,
  card_id        text NOT NULL REFERENCES cards(id),
  foil           boolean NOT NULL DEFAULT false,
  status         text NOT NULL DEFAULT 'raw'
                 CHECK (status IN ('raw', 'submitted', 'graded')),
  grader         text,                -- PSA | BGS | CGC | TAG | ...
  cert_id        text,
  grade          text,                -- '10', '9.5', 'Pristine 10' ...
  declared_value numeric(12,2),
  submitted_at   date,
  graded_at      date,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS graded_copies_card_idx ON graded_copies (card_id);
