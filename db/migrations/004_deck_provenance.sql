-- Deck provenance: where a deck was created and last modified ('mcp', 'webui',
-- 'api'). Idempotent.

ALTER TABLE decks ADD COLUMN IF NOT EXISTS created_source text NOT NULL DEFAULT 'api';
ALTER TABLE decks ADD COLUMN IF NOT EXISTS updated_source text;
