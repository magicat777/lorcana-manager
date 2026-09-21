"""duels-replay-v1 parser (handoff §4). One file was inspected when the
format was documented — every type list is a floor, so unknown actionTypes
and log types are warnings, never failures. Log entries with undone=true
are skipped for metrics (the replay's own take-back truth); FREE_UNDO
frames are counted as the undo metric.

Safety: JSON only, decompressed size capped, no field is ever executed or
followed; cardRefs names are data. Perspective files (_p1/_p2) contain
Jason's opening hand and deck order — metrics keep card names, never deck
order, and nothing here reaches shared surfaces.
"""
import gzip
import json
from collections import Counter

PARSE_VERSION = 3
MAX_JSON_BYTES = 5 * 1024 * 1024

KNOWN_ACTIONS = {
    "CHOOSE_STARTING_PLAYER", "MULLIGAN", "ADD_TO_INK", "PLAY_CARD", "QUEST",
    "ATTACK", "ACTIVATE_ABILITY", "RESPOND_TO_PROMPT", "END_TURN", "CONCEDE",
    "GAME_FINISH",
    # observed in the first real backfill (2026-09-20), absent from the
    # handoff's one-file survey:
    "BOOST", "MOVE_TO_LOCATION",
}
KNOWN_LOGS = {
    "INITIAL_HAND", "MULLIGAN", "GAME_START", "TURN_START", "TURN_READY",
    "TURN_SET", "TURN_DRAW", "TURN_END", "CARD_DRAWN", "CARD_INKED",
    "CARD_PLAYED", "CARD_QUEST", "CARD_ATTACK", "DAMAGE_DEALT",
    "CARD_DESTROYED", "CARD_DISCARDED", "CARD_RETURNED", "ABILITY_TRIGGERED",
    "ABILITY_ACTIVATED", "ABILITY_CONDITION_FAILED", "CHOICE_RESOLVED",
    "FREE_UNDO", "TIMER_STARTED", "TIMER_INCREMENT", "GAME_CONCEDED",
    "GAME_END",
    # observed across the full 77-replay backfill (2026-09-20):
    "ABILITY_DECLINED", "CARD_BOOSTED", "CARD_MOVED", "CARD_PUT_INTO_INKWELL",
    "QUICK_CHAT", "LORE_GAINED", "DAMAGE_COUNTERS_MOVED", "SUPPORT_GIVEN",
    "CARD_REVEALED", "DAMAGE_REMOVED", "CARD_RETURNED_TO_DECK",
}


def parse_replay(gz_bytes: bytes) -> tuple[dict, list[str]]:
    """Returns (metrics, warnings). Raises ValueError on structural failure."""
    raw = gzip.decompress(gz_bytes)
    if len(raw) > MAX_JSON_BYTES:
        raise ValueError(f"decompressed replay exceeds {MAX_JSON_BYTES} bytes")
    d = json.loads(raw)
    if d.get("format") != "duels-replay-v1":
        raise ValueError(f"unknown replay format {d.get('format')!r}")

    warnings: list[str] = []
    me = int(d.get("perspective") or 1)
    base = d.get("baseSnapshot") or {}
    toss = (base.get("coinToss") or {})
    my_snap = base.get("myPlayer") or {}

    # baseSnapshot.firstPlayer is a CONSTANT 2 across the corpus (sim
    # session's tier-2 finding, 2026-09-21) — the seat that actually took
    # turn 1 is the first TURN_START log's player (agrees with mulligan
    # frame order per CR 2.2.2 in 30/30 checked games).
    first_player = None
    for lg in d.get("logs") or []:
        if lg.get("type") == "TURN_START" and not lg.get("undone") \
                and lg.get("player") in (1, 2):
            first_player = lg["player"]
            break
    frames = d.get("frames") or []
    actions_by_player: dict[int, Counter] = {1: Counter(), 2: Counter()}
    undo_counts = {1: 0, 2: 0}
    end_turns = {1: 0, 2: 0}
    for f in frames:
        at = str(f.get("actionType") or "")
        p = f.get("player")
        # real files carry both "FREE_UNDO:<seq>" and plain "UNDO:<seq>"
        if at.startswith(("FREE_UNDO", "UNDO:")):
            if p in (1, 2):
                undo_counts[p] += 1
            continue
        if at not in KNOWN_ACTIONS:
            warnings.append(f"unknown actionType {at!r}")
            continue
        if p in (1, 2):
            actions_by_player[p][at] += 1
            if at == "END_TURN":
                end_turns[p] += 1

    # per-card lifecycle from logs[], honoring `undone`
    drawn: Counter = Counter()
    played: Counter = Counter()
    inked: Counter = Counter()
    first_played_turn: dict[str, int] = {}
    mulligan_count = None
    opening_hand: list[str] = []
    for lg in d.get("logs") or []:
        if lg.get("undone"):
            continue
        t = str(lg.get("type") or "")
        if t not in KNOWN_LOGS:
            warnings.append(f"unknown log type {t!r}")
            continue
        p = lg.get("player")
        names = [c.get("name") for c in (lg.get("cardRefs") or []) if c.get("name")]
        if t == "INITIAL_HAND" and p == me:
            opening_hand = names
        elif t == "MULLIGAN" and p == me:
            mulligan_count = len(names)
        elif p == me and names:
            n = names[0]
            if t in ("CARD_DRAWN", "TURN_DRAW"):
                drawn[n] += 1
            elif t == "CARD_PLAYED":
                played[n] += 1
                first_played_turn.setdefault(n, int(lg.get("turnNumber") or 0))
            elif t in ("CARD_INKED", "CARD_PUT_INTO_INKWELL"):
                # effect-driven inkwell placement counts as leaving the hand
                # usefully — otherwise stuck_at_end over-counts those cards
                inked[n] += 1

    # objective dead-card signal: drawn (or kept in hand) but neither played
    # nor inked by game end
    stuck = {n: c for n, c in
             ((n, drawn[n] + (1 if n in opening_hand else 0)
               - played.get(n, 0) - inked.get(n, 0)) for n in
              set(drawn) | set(opening_hand))
             if c > 0}

    mine = actions_by_player.get(me, Counter())
    quests, challenges = mine.get("QUEST", 0), mine.get("ATTACK", 0)
    metrics = {
        "perspective": me,
        "winner": d.get("winner"),
        "victory_reason": d.get("victoryReason"),
        "turn_count_raw": d.get("turnCount"),   # duels' scale — see handoff §1.3
        "won_toss": toss.get("youWonToss"),
        "toss_chooser": toss.get("chooser"),
        "first_player": first_player or base.get("firstPlayer"),
        "first_player_source": "turn_start" if first_player else "base_snapshot",
        "is_bot": base.get("isBotGame"),
        "is_ranked": base.get("isRanked"),
        "mulligan_count": mulligan_count,
        "opening_hand": opening_hand,
        "ink_drops": mine.get("ADD_TO_INK", 0),
        "turns_taken": end_turns.get(me, 0),
        "quest_actions": quests,
        "challenge_actions": challenges,
        "quest_challenge_ratio": round(quests / challenges, 2) if challenges else None,
        "cards_played": sum(played.values()),
        "undo_count_me": undo_counts.get(me, 0),
        "undo_count_opp": undo_counts.get(3 - me, 0),
        "actions": {str(p): dict(c) for p, c in actions_by_player.items()},
        "per_card": {n: {"drawn": drawn.get(n, 0), "played": played.get(n, 0),
                         "inked": inked.get(n, 0),
                         "first_played_turn": first_played_turn.get(n),
                         "stuck_at_end": stuck.get(n, 0)}
                     for n in set(drawn) | set(played) | set(inked) | set(opening_hand)},
    }
    # de-dup warnings, keep order
    seen: set[str] = set()
    warnings = [w for w in warnings if not (w in seen or seen.add(w))]
    return metrics, warnings
