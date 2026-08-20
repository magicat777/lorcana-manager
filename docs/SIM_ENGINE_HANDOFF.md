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

The sim session's item #9 (meta-weighted gauntlet) flagged missing opponent
inks in the match log. **Resolved 2026-08-18 — not a data gap.** The 6
inkless rounds are all Gamelandia *sealed league* (event #6 2026-08-10,
event #9 2026-08-17), and per Jason the opponents are on mixed/varied piles
with no consistent ink dominance yet — there is no ink pair to backfill.
Both events now carry a note saying so. Implication for #9: build the
meta-weighted gauntlet from **constructed** rounds only (all of which have
inks); sealed-league rounds carry no constructed-meta signal and NULL inks
there are expected, not missing. If the league's decks focus as pools grow,
future rounds will get inks logged normally.

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

**Scope correction (2026-08-19, from the sim session's review):** this doc
originally scoped replay to "public information only", and that premise was
**wrong**. Real duels.ink logs contain both starting hands, the full
mulligan with drawn cards, every draw, every ink, and all challenges and
banishes — close to complete game state. Genuine `legal_actions()` replay
(near state-exact, not arithmetic-only) is therefore achievable. The
arithmetic-only validator built to the original scoping remains valid as a
first tier; upgrading to full-state replay is a **deliberate design
decision for the sim session to take**, not a bug fix. The `raw_log` in the
corpus carries all of it — our `parsed` summary (plays/quests/lore) is a
convenience index, not the ceiling.

**What to check per game** (minimum tier, as originally scoped):

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

**Improvement plan status (2026-08-19):** items 1–9 of the parser/manager
plan (`~/Downloads/lorcana-manager-improvement-plan.md`) are implemented:
import `overwrite` replaces round + stored log atomically (item 1);
timestamped bookmarklet dialect parses, undo markers kept as per-turn
`undo_counts` in `parsed` (2); cross-player lore attribution by tracked-total
match (3); ingest validation quarantines inconsistent logs via
`corpus_excluded`/`exclude_reason` — replay corpus skips them by default (4);
threats ranked by impact (banishes ×3, bounces ×3, lore swings, draws —
verified: game 2 now tops Mother Knows Best, not Tibbs) (5); event reuse is
date+store, creation-path-independent (the #14 dupe was the UTC-date bug,
fixed) (6); identical retried imports and log_match calls are no-op
successes (7); `event_type` practice|sanctioned|casual on events, filters on
match stats + cut list, duels imports default practice (8); importer takes
mvp/dead/tags/threat overrides, log_match overwrite documented as full
REPLACE (9). Game-3 fixtures (corrupt + clean capture) still need a real
import to exercise 2/4 end-to-end.

**The log is a witness, not an oracle (2026-08-19).** Jason has observed
duels.ink's own engine dropping lore sequences in some games. The importer
now audits every log's internal lore bookkeeping (per-player transition
chains, with unattributed ability lines accepted as explanations, DFS with
backtracking for shared from-values) and stores unexplained jumps in
`parsed.anomalies`. Validator rule: a game with non-empty `anomalies` must
NOT count a lore divergence against the engine — use a divergence kind like
`log_inconsistent` instead of `lore_mismatch`, or skip the game. Action
legality checking is unaffected (plays/challenges aren't the buggy part).
The Amber/Emerald log on file audits clean; the affected game Jason saw
was never imported.

## Reporting (already live)

- `GET /api/duels/replay-status` — per-build clean/diverged counts + open
  divergences; surfaced to Claude as the `lorcana_replay_status` MCP tool.
- `lorcana_coverage_priority` (MCP) — which unspecced cards real games play
  most; speccing these grows the `replayable_only=true` corpus.
- `lorcana_sim_calibration` (MCP) / `GET /api/sim/calibration` — sim win
  rates vs real records per matchup, Wilson CIs both sides; `DIVERGES` rows
  are where replay divergences and policy gaps are most likely hiding.

## Availability semantics change: collector grading (2026-08-19)

Migration 030 adds a collector-grading lifecycle (`graded_copies`: one row
per physical copy, status raw → submitted → graded). The part that touches
sim-side assumptions: **free-copy availability now excludes slabbed copies**
— everywhere `free` is computed it is `owned − allocated_to_built_decks −
slabbed(submitted|graded)`, and card/deck API payloads carry new
`qty_slabbed` / `slabbed` fields.

What this means for the sim session:

- **Sim runs and scouting are unaffected** — sim-only decks never touch
  ownership, and `engine_coverage` / the replay corpus don't care whether a
  copy is slabbed.
- **Physical-build advice must respect it**: anything reading
  `/decks/{id}` free columns, `/decks/{id}/buildable`, or the want lists
  already gets slab-adjusted numbers for free. Don't recompute availability
  from `collection` counts directly — a graded PSA-10 copy still sits in
  `qty_normal` (it's owned) but cannot be sleeved into a deck.
- `status='raw'` = earmarked for grading, still playable; only
  submitted/graded are out of the pool.
- New shared MCP tools after reconnect: `lorcana_graded` (portfolio),
  `lorcana_grade_card` (lifecycle writes; omitted = untouched, '' clears,
  0 is a real declared value, negative declared_value clears to unset).

**Review-pass correction (2026-08-19 evening).** A 16-finding review of the
grading integration found and fixed a hole in the invariant this section
states: the **donor-pull path** (`PUT /decks/{id}/in_use` with
`pull_from_decks`) originally used raw owned counts, so a deck could be
marked built — un-building donor decks — while its "available" copies sat in
slabs. Fixed: every availability computation, donor pulls included, now goes
through one shared `slabbed_count_sql()` fragment. Also fixed: want-list
`owned` floors at 0 (a replace re-scan drops slabs from the binder, and
negative owned inflated need), and grading status regressions now clear
stale submit/grade dates. Net for the sim session: the "trust the API's
free/buildable numbers, never recompute from collection counts" rule is now
enforced without exception — if you cached any availability logic before
this date, re-read it from the API.

**Incident note (2026-08-20): deck #25 briefly overwritten, restored from
backup.** An ultrareview fix added a name-collision guard to
`/duels/scout`, but its first version treated `sim_only` as "safe to
overwrite" — and deck #25 (Hunny Rescue v5.2, flagged sim_only for
pre-build engine testing) was clobbered during verification. It was fully
restored from the 02:00 PT backup (recipe + notes; the sim_only flag and
anything set after 02:00 was untouched by the restore — worth a quick
sanity check if you edited #25 between 02:00 and ~17:30 PT). The guard now
permits in-place re-scouting ONLY for `created_source='scout'` decks;
sim_only is not a disposability proxy. Also landed from the same review:
`queue_sim` now actually persists `opponent_policy`/`require_build`
(previously validated then silently dropped — every queued run stored NULL),
and the web Sim page's paired-delta grouping + re-run button now carry
`opponent_policy`, closing the client-side gap in your same_pilots gate.
