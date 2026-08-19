# Handoff: replay-validation of real duels.ink games (engine side)

*Written 2026-08-18 by the collection-manager session for the Lorcana-Sim
session. Our side (storage, corpus API, verdict API, MCP reporting) is
deployed; what remains is the validator that lives naturally in the
Lorcana-Sim repo, next to `tools/verify_log_arithmetic.py`.*

## Why now (state at handoff, 2026-08-18)

From the sim session's own flag: the RECON opponent skeletons (decks #26,
#27) are ~⅔ invented filler, and sims against them say ~60% win where the
real record is 1-in-19 — the canonical `DIVERGES` row. Real imported
decklists via `lorcana_scout_deck` replace those guesses outright as the
duels.ink corpus grows (deck notes state the observed/60 fraction, so you
can see the guesswork shrink).

The sim session's item #9 (meta-weighted gauntlet) is blocked on missing
opponent inks in the match log. Verified on this side: exactly **6 rounds**
lack `opp_ink_1` — Gamelandia sealed league, event #6 (2026-08-10, R1–R3:
Brandon/Allan/Kevin) and event #9 (2026-08-17, R1–R3: Harry/Allan/Ben).
Only Jason can supply those from memory: edit the rounds on the event pages,
or `lorcana_log_match(event_id=…, round=…, inks=…, overwrite=True)`.

Sim-session status for reference: reporting batch (#3/#4/#5/#10),
turning-point confidence floor (#7), recurrence analysis (#8) deployed;
#6 closed by measurement (altering has no effect on deck 20, p=1.0 at
n=600). Engine image engine-20260817-fable-3.

## The idea

Every duels.ink game Jason imports (`lorcana_import_duels_log`) is stored in
full — raw turn-by-turn log plus parsed plays/quests/lore per seat. Because
the engine guarantees *illegal play is unrepresentable*, each real game is a
free regression test: replay the public actions and any divergence is an
engine bug or a mis-specced card, found by a real game instead of a synthetic
one.

## Data contract

**Fetch the corpus:** `GET /api/duels/replay-corpus?replayable_only=true`
(in-cluster: `http://lorcana-api.lorcana.svc.cluster.local:8000`).
Each entry: `id`, `raw_log` (the duels.ink text), `parsed`
(`plays/quests/lore` keyed by seat `"1"/"2"`), `my_player`, `winner`,
`first_player`, `turns`, `card_map` (log card name → `{card_id, full_name,
covered}`), `replayable` (every played name matched AND engine-covered), and
any prior `validations`. With `replayable_only=false` you also get games
containing unspecced cards — useful once those specs land.

**What to check per game** (public information only — hands and deck order
are not in the log, so this is action-legality + arithmetic, not seed-exact
state replay):

1. Each `Player N played/sang X` and quest/challenge action must exist in
   `legal_actions()` for a state consistent with the visible board
   (unknown hands modeled as wildcards/supersets).
2. Lore arithmetic: every `(+N [LORE], a -> b)` and location-lore line must
   match the engine's computed lore for that action.
3. Card resolution: every log name resolves via `card_map`; a `null` entry
   is an `unknown_card` divergence (parser or promo quirk — report it).

**Post one verdict per game:** `POST /api/duels/replay-validations`

```json
{"log_id": 7, "engine_build": "engine-20260818a", "ok": false,
 "actions_checked": 42,
 "divergences": [{"turn": 4, "line": "Player 2 sang ...",
                  "kind": "illegal_action|lore_mismatch|unknown_card",
                  "detail": "engine says Shift target invalid: ..."}]}
```

Upserts on `(log_id, engine_build)` — re-running after a fix overwrites the
verdict. Suggested cadence: a step in the nightly sim CronJob, so every new
engine build re-validates the whole corpus.

## Reporting (already live)

- `GET /api/duels/replay-status` — per-build clean/diverged counts + open
  divergences; surfaced to Claude as the `lorcana_replay_status` MCP tool.
- `lorcana_coverage_priority` (MCP) — which unspecced cards real games play
  most; speccing these grows the `replayable_only=true` corpus.
- `lorcana_sim_calibration` (MCP) / `GET /api/sim/calibration` — sim win
  rates vs real records per matchup, Wilson CIs both sides; `DIVERGES` rows
  are where replay divergences and policy gaps are most likely hiding.
