-- Lorcana schema. Run as role 'lorcana' against database 'lorcana'.
-- Idempotent: every statement is IF NOT EXISTS / additive.

CREATE TABLE IF NOT EXISTS sets (
  id           text PRIMARY KEY,           -- Lorcast set id (set_...)
  code         text UNIQUE NOT NULL,       -- '1'..'9', 'P1', 'P2', 'cp', 'D23', ...
  set_num      int,                        -- numeric part when code is numeric (dreamborn match key)
  name         text NOT NULL,
  released_at  date,
  raw          jsonb NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS set_aliases (
  alias   text PRIMARY KEY,                -- normalized: lower(trim(value))
  set_id  text NOT NULL REFERENCES sets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cards (
  id                text PRIMARY KEY,      -- Lorcast card id (crd_...)
  set_id            text NOT NULL REFERENCES sets(id),
  collector_number  text NOT NULL,         -- kept as text ('204', '1p', ...)
  name              text NOT NULL,
  version           text,                  -- subtitle, e.g. 'Spirit of Winter' (null for actions/items)
  full_name         text GENERATED ALWAYS AS (name || COALESCE(' - ' || version, '')) STORED,
  ink               text,
  cost              int,
  inkwell           boolean,
  type              text[],
  classifications   text[],
  keywords          text[],
  body_text         text,
  flavor_text       text,
  strength          int,
  willpower         int,
  lore              int,
  move_cost         int,
  rarity            text,
  illustrators      text[],
  lang              text,
  layout            text,
  released_at       date,
  tcgplayer_id      bigint,
  image_small       text,
  image_normal      text,
  image_large       text,
  legalities        jsonb,
  price_usd         numeric(10,2),
  price_usd_foil    numeric(10,2),
  prices_updated_at timestamptz,
  raw               jsonb NOT NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (set_id, collector_number)
);
CREATE INDEX IF NOT EXISTS cards_fullname_idx ON cards (lower(full_name));
CREATE INDEX IF NOT EXISTS cards_name_idx     ON cards (lower(name));
CREATE INDEX IF NOT EXISTS cards_filter_idx   ON cards (set_id, ink, rarity);

CREATE TABLE IF NOT EXISTS collection (
  card_id     text PRIMARY KEY REFERENCES cards(id),
  qty_normal  int NOT NULL DEFAULT 0 CHECK (qty_normal >= 0),
  qty_foil    int NOT NULL DEFAULT 0 CHECK (qty_foil >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS imports (
  id              bigserial PRIMARY KEY,
  filename        text NOT NULL,
  file_sha256     text NOT NULL,
  uploaded_at     timestamptz NOT NULL DEFAULT now(),
  mode            text NOT NULL CHECK (mode IN ('merge','replace')),
  dry_run         boolean NOT NULL DEFAULT false,
  row_count       int,
  matched_rows    int,
  unmatched_count int,
  unmatched_rows  jsonb,                   -- [{row, name, set, number, reason}]
  summary         jsonb                    -- {added, updated, zeroed, qty_before, qty_after}
);

CREATE TABLE IF NOT EXISTS decks (
  id          bigserial PRIMARY KEY,
  name        text UNIQUE NOT NULL,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deck_cards (
  deck_id  bigint NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  card_id  text   NOT NULL REFERENCES cards(id),
  qty      int    NOT NULL CHECK (qty > 0),   -- UI warns above 4; DB does not enforce
  PRIMARY KEY (deck_id, card_id)
);
