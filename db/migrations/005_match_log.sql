-- Match Log: tournament events, per-round matches, per-game results, and
-- open-ended observations (threat cards, tags, my dead/MVP cards).
-- Observations attach to a match OR an event (post-event lists). Idempotent.

CREATE TABLE IF NOT EXISTS events (
  id            bigserial PRIMARY KEY,
  date          date NOT NULL,
  store         text NOT NULL,
  format        text NOT NULL DEFAULT 'Core Constructed',
  player_count  int,
  rounds        int,
  deck_id       bigint REFERENCES decks(id) ON DELETE SET NULL,
  deck_version  text,
  entry_fee     numeric(6,2),
  final_record  text,
  packs_won     int,
  promo         boolean,
  biggest_problem text,          -- one thing (the sheet says: not four)
  one_change    text,            -- one card in, one out, re-test
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS matches (
  id              bigserial PRIMARY KEY,
  event_id        bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  round           int NOT NULL,
  opponent_handle text,
  result          text CHECK (result IN ('2-0','2-1','1-2','0-2','DRAW','BYE')),
  opp_ink_1       text,
  opp_ink_2       text,
  opp_shape       text CHECK (opp_shape IN ('lore_rush','aggro','midrange','control','unclear')),
  one_liner       text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, round)
);
CREATE INDEX IF NOT EXISTS matches_event_idx ON matches (event_id);

CREATE TABLE IF NOT EXISTS games (
  id            bigserial PRIMARY KEY,
  match_id      bigint NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  game_no       int NOT NULL CHECK (game_no BETWEEN 1 AND 3),
  on_play       boolean,
  won           boolean,
  loss_mode     text CHECK (loss_mode IN ('race','board','flood','screw','time','na')),
  cards_altered int,
  UNIQUE (match_id, game_no)
);
CREATE INDEX IF NOT EXISTS games_match_idx ON games (match_id);

CREATE TABLE IF NOT EXISTS observations (
  id            bigserial PRIMARY KEY,
  match_id      bigint REFERENCES matches(id) ON DELETE CASCADE,
  event_id      bigint REFERENCES events(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN
                  ('threat_card','tag','my_dead_card','my_mvp','never_drew','always_dead')),
  value         text NOT NULL,
  card_set_code text,            -- resolved against the catalog when possible
  card_number   text,
  CHECK (num_nonnulls(match_id, event_id) = 1)
);
CREATE INDEX IF NOT EXISTS observations_match_idx ON observations (match_id);
CREATE INDEX IF NOT EXISTS observations_event_idx ON observations (event_id);
