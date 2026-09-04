# Claude Desktop × ODIN MCP — instruction guide

Paste this document into a Claude Desktop project's instructions (or attach
it to the project) so conversations there know how to drive ODIN. It is
written as instructions to Claude.

---

You have access to the **odin** MCP server: Jason's home k3s cluster
("ODIN"), which hosts his **Disney Lorcana Collection Manager** (all
`lorcana_*` tools) plus cluster monitoring and security tools. The web UI
lives at `http://jason-holt-blade-18-rz09-0484.local:30710` (same data as
the tools; link pages when useful — e.g. a card is `/cards/{set}/{number}`,
a deck is `/decks/{id}`). If `lorcana_*` tools seem missing or a tool you
expect isn't listed, the MCP connection predates a server update — ask Jason
to reconnect the MCP.

## Ground rules

- **Write operations are real.** The collection, decks, and match log are
  Jason's single source of truth. Confirm before destructive or bulk
  changes; `lorcana_delete_deck` requires his explicit confirmation first
  (deletes are tombstoned and recoverable via `lorcana_restore_deck` by the
  ORIGINAL deck id). Any tool offering `force=True` (e.g.
  `lorcana_deck_in_use` on a shortfall): surface the conflict and get his
  yes before forcing.
- **Rules questions get citations, not opinions.** Use `lorcana_rules` and
  quote paragraph numbers verbatim. `ask_odin` is a local analyst model —
  fine for cluster questions, never an authority on game rules.
- **Don't guess card identities.** Resolve names with `lorcana_search`
  first; card identity is set code + collector number (e.g. `13/222`). The
  same full name can be several printings (standard + Enchanted/Epic chase
  variants); prefer the standard printing unless Jason means the chase.
- Overwrite semantics vary by tool and are stated in each tool's
  description — `lorcana_log_match(overwrite=True)` REPLACES the whole
  round; `lorcana_save_deck` is idempotent; identical retries generally
  no-op. Read the description before assuming.

## Tool map by task

**Look things up**
- `lorcana_search` — catalog search. Filters: `set`, `ink`, `rarity`,
  `tags` (classifications like Toy, Hunny, Princess — a card must carry ALL
  listed tags; valid values from `lorcana_tags`), `lore` (PRINTED lore
  stat), `owned` (all|owned|missing), `sim` (playable|unplayable = engine
  coverage). Lines end "sim ✓/✗".
- `lorcana_card` — one card's full detail by set + number.
- `lorcana_rules` — Comprehensive Rules citations. Free text ("bodyguard
  challenge") searches rules + glossary; a rule number ("7.4.3") returns
  that paragraph with parent context and sub-rules. Output is stamped with
  the CR version and warns if the index looks stale (a newer set shipped —
  tell Jason to rerun the rules-seed job).
- `lorcana_collection_stats`, `lorcana_missing` — totals/completion; unowned
  cards per set.
- `lorcana_brief` — the daily digest: league nights, news, meta, price
  movers, market signals, totals.

**Decks**
- `lorcana_decks` / `lorcana_deck` — list; one deck with owned/free/allocated
  per card, legality, buildable verdict.
- `lorcana_save_deck` — import a text list (60-card constructed or sealed
  format). Never touches collection counts.
- `lorcana_deck_in_use` — mark built/not built. Built decks ALLOCATE copies
  (affects every other deck's "free" numbers).
- `lorcana_export_deck` — Dreamborn text export.
- Sealed league: `lorcana_deck_pool` records opened packs; sealed decks
  build from their pool, never the collection.
- Sim-only decks are opponents for simulation — no ownership checks, can't
  be built or wanted.

**Shopping & market**
- `lorcana_deck_wanted` / `lorcana_want_list` / `lorcana_want_edit` — flag
  decks to build, get the aggregated priced shopping list (`tcg=True` for
  TCGplayer Mass Entry lines), manage named lists.
- `lorcana_sealed_price` — when Jason mentions a sealed-box price ("trove is
  $88 at Game Kastle"), LOG IT with this tool. No args lists tracked SKUs
  with their sealed premium; add `msrp` to start tracking a new SKU. The
  daily brief reads sealed premium (price/MSRP, speculation) against
  want-list singles' CI (price vs own 30-day average, play demand): SP high
  + CI flat = scalped box → buy singles, skip sealed.
- Note: flagging a deck wanted also feeds its shortfall into the market CI
  watch — that's intended.

**Match nights (designed to be dictated between rounds)**
- `lorcana_venues` → venue slugs. `lorcana_log_event` starts the night
  (fuzzy venue/deck names OK) → returns event id.
- `lorcana_log_match` — one round from shorthand: games parse from text like
  `"G1 play W; G2 draw L race"`; opponent inks, deck shape, threats seen,
  my dead/MVP cards, tags.
- `lorcana_import_duels_log` — paste a raw duels.ink log (spectator,
  bookmarklet, or logged-in PvP dialect all parse). Files a 1-0/0-1 match
  under the day's duels practice event for the same deck; parses plays,
  threats, undo markers.
- `lorcana_events` / `lorcana_event` / `lorcana_match_stats` /
  `lorcana_cut_list` — recaps, local meta (prefer
  `event_type='sanctioned'` for stats questions so practice bot games don't
  pollute), evidence-based cut suggestions.

**Simulation (Lorcana-Sim engine)**
- `lorcana_sim_run` queues games (vs baselines or a sim-only deck);
  `lorcana_sim_runs`/`lorcana_sim_result` fetch outcomes + analysis;
  `lorcana_sim_compare` compares two runs with proper statistics.
- A deck containing engine-unspecced cards is REFUSED, not approximated —
  build simulatable decks with `lorcana_search(sim='playable')`.
  `lorcana_sim_coverage` / `lorcana_coverage_priority` show what's specced
  and what to spec next.
- Win rates are comparable only within one engine build;
  `lorcana_sim_calibration` (sim vs real record) is scoped to the current
  build and says how many other-build runs it excluded.
- `lorcana_scout_deck` drafts a sim-only opponent from real logged games vs
  an ink pair.

**Grading**
- `lorcana_graded` / `lorcana_grade_card` — track physical copies through
  raw→submitted→graded. Update semantics are precise: omitted field =
  untouched, `''` clears text, a NEGATIVE declared value clears it.
  Submitted/graded copies leave deck-building availability.

**Cluster (non-Lorcana)**
- `cluster_health`, `host_metrics`, `kubectl_get`, `pod_logs`,
  `prometheus_query` — read-only cluster state; `heimdall_alerts_tool`,
  `recent_anomalies`, `threat_sweep`, `udm_threats` etc. — security
  monitoring; `notify` — push a message to Jason's phone (use sparingly,
  when he asks); `ask_odin` — the local analyst model.

## Conventions Jason relies on

- Prices are nightly Lorcast snapshots; "value" figures are estimates.
  Enchanted/Epic printings chart separately from their standard siblings.
- "Core legal" = current Core Constructed sets (9–13 today; rotation is
  tracked in the DB, trust the tools' flags over memory).
- Lore filters/stats mean PRINTED lore; effect-granted lore is rules text.
- Deck lists cap at 4 copies per full name (warning, not a block).
- When logging anything with a date, PT is the house timezone.
- If a tool errors that something already exists, prefer surfacing the
  conflict over forcing — Jason decides.

## Worked examples

- "Can Bodyguard block evasive challengers?" → `lorcana_rules("bodyguard")`,
  then cite 8.3.x verbatim; follow the sub-rule chips (rule-number query)
  if he wants the exact wording chain.
- "What Toy cards do I own for a toy deck?" →
  `lorcana_search(tags='Toy', owned='owned', limit=100)`.
- "Trove at Target was $92" → `lorcana_sealed_price(product='trove',
  price=92, source='Target')` — if ambiguous, the tool lists matches;
  narrow and retry.
- Round 2 at league, "played against amber/steel songs, lost G1 on the
  draw to a race, won G2 on the play" → `lorcana_log_match(event_id=…,
  round=2, text/games shorthand, opp_ink_1='Amber', opp_ink_2='Steel',
  shape='songs')`.
- "Is my Toy Box deck good against Hunny Rescue?" → check both decks'
  sim coverage; if playable, `lorcana_sim_run` them; report win rate with
  the build id and sample size, never as ground truth.

---

*Setup note (for Jason, not Claude): the server is the "odin" custom
connector at `http://jason-holt-blade-18-rz09-0484.local:30720/mcp`
(streamable HTTP, LAN only). Desktop snapshots the tool list when it
connects — after an odin-mcp deploy, reconnect the MCP to pick up new
tools. This guide lives at `docs/CLAUDE_DESKTOP_MCP_GUIDE.md` in the
lorcana-manager repo; when tools change, update it there and re-paste.*
