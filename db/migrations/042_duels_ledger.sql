-- duels.ink account-ledger import (2026-09-18, per
-- docs/ODIN_duels_ledger_replay_handoff.md). THE point: ODIN's duels sample
-- was survivorship-biased (manual paste-per-game captured 18/32 wins but
-- only 10/43 losses, Fisher p≈0.004) — every practice-evidence tool
-- inherited it. duels_games is the COMPLETE ledger, keyed on duels'
-- game_id; text logs remain the card-level detail layer, linked via
-- match_row_id. Additive + idempotent.
--
-- Privacy (per the handoff): your_user_id is never stored;
-- opp_display_name stays out of shared/exported surfaces.

CREATE TABLE IF NOT EXISTS duels_games (
  game_id            text PRIMARY KEY,           -- duels UUIDv7
  mode               text NOT NULL,              -- bot | matchmaking
  queue_id           text,
  queue_name         text,
  season_name        text,
  match_format       text,
  duels_match_id     text,
  match_game_number  int,
  ranked             boolean NOT NULL,
  started_at         timestamptz NOT NULL,
  ended_at           timestamptz NOT NULL,
  played_on_pt       date NOT NULL,
  duration_seconds   int,
  -- raw duels value; NOT ODIN's per-player T-numbers (≈ceil(T/2), exact
  -- semantics unverified — never mix the two scales in one column
  duels_turns        int,
  result             text NOT NULL CHECK (result IN ('win','loss','abandoned')),
  end_reason         text,
  conceded_by        text,                       -- me | opponent | NULL
  your_player        int,
  went_first         boolean,
  your_lore          int,
  opp_lore           int,
  mmr_before         int,
  mmr_after          int,
  mmr_delta          int,
  is_placement       boolean,
  duels_deck_id      text,
  deck_id            bigint REFERENCES decks(id) ON DELETE SET NULL,
  deck_version_hash  text,
  your_deck_colors   text,
  opp_display_name   text,
  opp_is_bot         boolean,
  opp_guest          boolean,
  opp_ink_1          text,
  opp_ink_2          text,                       -- NULL for mono-ink
  opp_kind           text,                       -- bot | pvp_ranked | pvp_casual
  replay_id          text,
  gamelog_id         text,
  match_row_id       bigint REFERENCES matches(id) ON DELETE SET NULL,
  is_trivial         boolean NOT NULL DEFAULT false,
  imported_at        timestamptz NOT NULL DEFAULT now(),
  source_file        text
);
CREATE INDEX IF NOT EXISTS duels_games_day_idx ON duels_games (played_on_pt);
CREATE INDEX IF NOT EXISTS duels_games_deck_idx ON duels_games (deck_id);

-- Deck-list snapshots: lorcana_save_deck(overwrite) replaces lists in
-- place, so history loses which VERSION played. Hash = sha1 of sorted
-- (resolved identity, count) tuples; list_json holds raw duels cardIds +
-- resolved names side by side.
CREATE TABLE IF NOT EXISTS deck_versions (
  hash        text PRIMARY KEY,
  deck_id     bigint REFERENCES decks(id) ON DELETE SET NULL,
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  list_json   jsonb NOT NULL,
  source      text NOT NULL                      -- duels-ledger | save_deck
);

-- duels deck-id -> ODIN deck. Seeded with the handoff's VERIFIED mappings
-- only (exact 60-card list matches); unverified ids stay unmapped and are
-- reported by the importer for Jason to map.
CREATE TABLE IF NOT EXISTS duels_deck_map (
  duels_deck_id  text PRIMARY KEY,
  deck_id        bigint NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  note           text
);
INSERT INTO duels_deck_map (duels_deck_id, deck_id, note) VALUES
  ('01a01646-e86d-709f-a6bd-c60e8ab3364a', 31, 'verified exact 2026-09-18'),
  ('01a06e03-8437-79de-969a-3029994b0d8a', 48, 'verified exact 2026-09-18'),
  ('01a08c1a-2018-7a31-8dd0-bd3de66d85ba', 50, 'verified exact 2026-09-18; sim-only flag question open'),
  ('01a020ec-568f-747d-bbf8-4fc7b95ab143', 43, 'verified association 2026-09-18 (list drift, see deck_versions)'),
  ('01a01b94-18d0-7ff1-a029-db8c67d00b3a', 43, 'INFERRED 2026-09-18: all-Hunny six-ink bot list, 6 games Aug 19-Sep 6 — desktop-session inference, not list-verified')
ON CONFLICT (duels_deck_id) DO NOTHING;
