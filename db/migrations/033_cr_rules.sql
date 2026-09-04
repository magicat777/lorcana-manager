-- Comprehensive Rules index (jobs/seed_rules.py): paragraph-numbered rules,
-- section headings, and glossary terms with full-text search. The text is
-- (c)Disney/Ravensburger and lives ONLY in this database — the public repo
-- carries the parser, never the extracted text. cr_meta stamps the loaded CR
-- release so a stale index is detectable (compare against the newest set's
-- release date). Idempotent.

CREATE TABLE IF NOT EXISTS cr_paragraphs (
  kind      text NOT NULL CHECK (kind IN ('section', 'rule', 'glossary')),
  key       text NOT NULL,   -- '7' / '7.4.3' / a glossary term
  title     text,            -- section titles and glossary terms
  body      text NOT NULL,
  sort_ord  int NOT NULL,    -- document order
  tsv       tsvector GENERATED ALWAYS AS
              (to_tsvector('english', coalesce(title, '') || ' ' || body)) STORED,
  PRIMARY KEY (kind, key)
);
CREATE INDEX IF NOT EXISTS cr_paragraphs_tsv_idx ON cr_paragraphs USING gin (tsv);

CREATE TABLE IF NOT EXISTS cr_meta (
  id              boolean PRIMARY KEY DEFAULT true CHECK (id),  -- single row
  version         text NOT NULL,
  effective_date  date,
  source_url      text,
  rules           int,
  glossary        int,
  loaded_at       timestamptz NOT NULL DEFAULT now()
);
