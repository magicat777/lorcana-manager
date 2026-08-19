"""Match Log: events -> matches -> games, with open-ended observations.
Fill between rounds, review before pairings (Lorcana tournament rule 5.2)."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import config, db

router = APIRouter()

RESULTS = ("2-0", "2-1", "1-2", "0-2", "1-0", "0-1", "DRAW", "BYE")
WIN_RESULTS = ("2-0", "2-1", "1-0", "BYE")
LOSS_RESULTS = ("1-2", "0-2", "0-1")
CARD_KINDS = ("threat_card", "my_dead_card", "my_mvp", "never_drew", "always_dead")


class GameIn(BaseModel):
    game_no: int = Field(ge=1, le=3)
    on_play: bool | None = None
    won: bool | None = None
    loss_mode: str | None = None      # race|board|flood|screw|time|na
    cards_altered: int | None = None


class ObservationIn(BaseModel):
    kind: str                          # threat_card|tag|my_dead_card|my_mvp|never_drew|always_dead
    value: str
    card_set_code: str | None = None
    card_number: str | None = None


class MatchIn(BaseModel):
    round: int = Field(ge=1)
    opponent_handle: str = ""
    result: str
    opp_ink_1: str = ""
    opp_ink_2: str = ""
    opp_shape: str | None = "unclear"
    one_liner: str = ""
    games: list[GameIn] = []
    observations: list[ObservationIn] = []
    overwrite: bool = False            # replace an existing round entry


class VenueIn(BaseModel):
    slug: str
    name: str
    city: str
    state: str = "CA"
    display_name: str = ""


class VenueUpdate(BaseModel):
    address: str | None = None
    lat: float | None = None
    lon: float | None = None
    active: bool | None = None
    event_night: str | None = None
    event_time: str | None = None
    notes: str | None = None


class EventIn(BaseModel):
    date: str
    store: str = ""                    # free text ("Other" venues); or use venue_slug
    venue_slug: str | None = None      # preferred: stable venue identifier
    format: str = "Core Constructed"
    player_count: int | None = None
    rounds: int | None = None
    deck_id: int | None = None
    deck_version: str = ""
    entry_fee: float | None = None
    notes: str = ""


class EventPost(BaseModel):
    # post-event fields
    final_record: str | None = None
    packs_won: int | None = None
    promo: bool | None = None
    biggest_problem: str | None = None
    one_change: str | None = None
    notes: str | None = None
    observations: list[ObservationIn] | None = None   # never_drew / always_dead lists
    # header fields — editable after the fact (all partial: None = unchanged)
    date: str | None = None
    store: str | None = None
    venue_slug: str | None = None      # resolves venue_id + display_name like create
    format: str | None = None
    deck_id: int | None = None
    deck_version: str | None = None
    rounds: int | None = None
    player_count: int | None = None
    entry_fee: float | None = None


def _resolve_card(cur, obs: ObservationIn) -> tuple[str | None, str | None]:
    """Fill set/number from the catalog by full name when not provided."""
    if obs.card_set_code or obs.kind not in CARD_KINDS:
        return obs.card_set_code, obs.card_number
    cur.execute(
        """SELECT s.code, c.collector_number FROM cards c JOIN sets s ON s.id=c.set_id
           WHERE lower(c.full_name)=lower(%s) ORDER BY c.released_at NULLS LAST LIMIT 1""",
        (obs.value.strip(),),
    )
    row = cur.fetchone()
    return (row["code"], row["collector_number"]) if row else (None, None)


def _record(match_rows: list[dict]) -> str:
    w = sum(1 for m in match_rows if m["result"] in WIN_RESULTS)
    l = sum(1 for m in match_rows if m["result"] in LOSS_RESULTS)
    d = sum(1 for m in match_rows if m["result"] == "DRAW")
    return f"{w}-{l}" + (f"-{d}" if d else "")


def _event_row(event_id: int) -> dict:
    ev = db.query_one(
        """SELECT e.*, d.name AS deck_name FROM events e
           LEFT JOIN decks d ON d.id = e.deck_id WHERE e.id=%s""", (event_id,))
    if not ev:
        raise HTTPException(404, "no such event")
    ev["matches"] = db.query(
        "SELECT * FROM matches WHERE event_id=%s ORDER BY round", (event_id,))
    for m in ev["matches"]:
        m["games"] = db.query(
            "SELECT * FROM games WHERE match_id=%s ORDER BY game_no", (m["id"],))
        m["observations"] = db.query(
            "SELECT * FROM observations WHERE match_id=%s ORDER BY id", (m["id"],))
    ev["observations"] = db.query(
        "SELECT * FROM observations WHERE event_id=%s ORDER BY id", (event_id,))
    ev["record"] = _record(ev["matches"])
    return ev


@router.get("/events")
def list_events(limit: int = 50):
    events = db.query(
        """SELECT e.id, e.date, e.store, e.format, e.rounds, e.player_count,
                  e.final_record, e.packs_won, e.promo, e.deck_version, d.name AS deck_name
           FROM events e LEFT JOIN decks d ON d.id = e.deck_id
           ORDER BY e.date DESC, e.id DESC LIMIT %s""", (min(limit, 200),))
    for ev in events:
        ms = db.query("SELECT result FROM matches WHERE event_id=%s", (ev["id"],))
        ev["record"] = _record(ms)
        ev["match_count"] = len(ms)
    return events


@router.get("/venues")
def list_venues(all: bool = False):
    """Active venues; nearest-first when home coords (LORCANA_HOME_LAT/LON,
    env-only — see config.py) and venue lat/lon are populated, else A-Z."""
    where = "" if all else "WHERE active"
    if config.HOME_LAT is None or config.HOME_LON is None:
        return db.query(f"SELECT * FROM venues {where} ORDER BY display_name")
    return db.query(
        f"""SELECT * FROM venues {where}
            ORDER BY (lat IS NULL),
                     ((lat - %s)^2 + (lon - %s)^2),
                     display_name""",
        (config.HOME_LAT, config.HOME_LON))


@router.post("/venues", status_code=201)
def create_venue(body: VenueIn):
    display = body.display_name or f"{body.name} — {body.city}"
    try:
        row = db.query(
            """INSERT INTO venues (slug, name, city, state, display_name)
               VALUES (%s,%s,%s,%s,%s) RETURNING *""",
            (body.slug, body.name, body.city, body.state, display))
    except Exception:
        raise HTTPException(409, f"venue slug {body.slug!r} already exists")
    return row[0]


@router.put("/venues/{slug}")
def update_venue(slug: str, body: VenueUpdate):
    sets, params = [], []
    for field in ("address", "lat", "lon", "active", "event_night", "event_time", "notes"):
        v = getattr(body, field)
        if v is not None:
            sets.append(f"{field}=%s")
            params.append(v)
    if not sets:
        raise HTTPException(422, "nothing to update")
    if db.execute(f"UPDATE venues SET {', '.join(sets)} WHERE slug=%s", params + [slug]) == 0:
        raise HTTPException(404, f"no venue {slug!r}")
    return db.query_one("SELECT * FROM venues WHERE slug=%s", (slug,))


@router.post("/events", status_code=201)
def create_event(body: EventIn):
    if body.deck_id is not None and not db.query_one(
            "SELECT 1 FROM decks WHERE id=%s", (body.deck_id,)):
        raise HTTPException(404, f"no deck #{body.deck_id}")
    venue_id, store = None, body.store.strip()
    if body.venue_slug:
        venue = db.query_one("SELECT id, display_name FROM venues WHERE slug=%s",
                             (body.venue_slug,))
        if not venue:
            raise HTTPException(404, f"no venue {body.venue_slug!r}")
        venue_id, store = venue["id"], venue["display_name"]
    if not store:
        raise HTTPException(422, "provide venue_slug or a free-text store name")
    row = db.query(
        """INSERT INTO events (date, store, venue_id, format, player_count, rounds,
                               deck_id, deck_version, entry_fee, notes)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
        (body.date, store, venue_id, body.format, body.player_count, body.rounds,
         body.deck_id, body.deck_version, body.entry_fee, body.notes))
    return _event_row(row[0]["id"])


@router.get("/events/{event_id}")
def get_event(event_id: int):
    return _event_row(event_id)


@router.put("/events/{event_id}")
def update_event(event_id: int, body: EventPost):
    if not db.query_one("SELECT 1 FROM events WHERE id=%s", (event_id,)):
        raise HTTPException(404, "no such event")
    if body.deck_id is not None and not db.query_one(
            "SELECT 1 FROM decks WHERE id=%s", (body.deck_id,)):
        raise HTTPException(404, f"no deck #{body.deck_id}")
    with db.pool.connection() as conn:
        with conn.cursor() as cur:
            sets, params = [], []
            for field in ("final_record", "packs_won", "promo",
                          "biggest_problem", "one_change", "notes",
                          "date", "store", "format", "deck_id", "deck_version",
                          "rounds", "player_count", "entry_fee"):
                v = getattr(body, field)
                if v is not None:
                    sets.append(f"{field}=%s")
                    params.append(v)
            if body.venue_slug:
                venue = db.query_one(
                    "SELECT id, display_name FROM venues WHERE slug=%s",
                    (body.venue_slug,))
                if not venue:
                    raise HTTPException(404, f"no venue {body.venue_slug!r}")
                sets += ["venue_id=%s", "store=%s"]
                params += [venue["id"], venue["display_name"]]
            if sets:
                cur.execute(f"UPDATE events SET {', '.join(sets)} WHERE id=%s",
                            params + [event_id])
            if body.observations is not None:
                cur.execute("DELETE FROM observations WHERE event_id=%s", (event_id,))
                for o in body.observations:
                    sc, num = _resolve_card(cur, o)
                    cur.execute(
                        """INSERT INTO observations (event_id, kind, value, card_set_code, card_number)
                           VALUES (%s,%s,%s,%s,%s)""",
                        (event_id, o.kind, o.value.strip(), sc, num))
        conn.commit()
    return _event_row(event_id)


@router.delete("/events/{event_id}", status_code=204)
def delete_event(event_id: int):
    if db.execute("DELETE FROM events WHERE id=%s", (event_id,)) == 0:
        raise HTTPException(404, "no such event")


def _write_match(conn, event_id: int, body: MatchIn) -> int:
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM matches WHERE event_id=%s AND round=%s",
                    (event_id, body.round))
        existing = cur.fetchone()
        if existing and not body.overwrite:
            raise HTTPException(
                409, f"round {body.round} already logged (send overwrite=true to replace)")
        if existing:
            cur.execute("DELETE FROM matches WHERE id=%s", (existing["id"],))
        cur.execute(
            """INSERT INTO matches (event_id, round, opponent_handle, result,
                                    opp_ink_1, opp_ink_2, opp_shape, one_liner)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
            (event_id, body.round, body.opponent_handle, body.result,
             body.opp_ink_1 or None, body.opp_ink_2 or None,
             body.opp_shape or None, body.one_liner))
        match_id = cur.fetchone()["id"]
        for g in body.games:
            cur.execute(
                """INSERT INTO games (match_id, game_no, on_play, won, loss_mode, cards_altered)
                   VALUES (%s,%s,%s,%s,%s,%s)""",
                (match_id, g.game_no, g.on_play, g.won, g.loss_mode, g.cards_altered))
        for o in body.observations:
            sc, num = _resolve_card(cur, o)
            cur.execute(
                """INSERT INTO observations (match_id, kind, value, card_set_code, card_number)
                   VALUES (%s,%s,%s,%s,%s)""",
                (match_id, o.kind, o.value.strip(), sc, num))
    return match_id


@router.post("/events/{event_id}/matches", status_code=201)
def add_match(event_id: int, body: MatchIn):
    if body.result not in RESULTS:
        raise HTTPException(422, f"result must be one of {RESULTS}")
    if not db.query_one("SELECT 1 FROM events WHERE id=%s", (event_id,)):
        raise HTTPException(404, "no such event")
    with db.pool.connection() as conn:
        _write_match(conn, event_id, body)
        conn.commit()
    return _event_row(event_id)


@router.delete("/matches/{match_id}", status_code=204)
def delete_match(match_id: int):
    if db.execute("DELETE FROM matches WHERE id=%s", (match_id,)) == 0:
        raise HTTPException(404, "no such match")


@router.get("/matchlog/ink-pairs")
def ink_pairs(store: str = "", last_events: int = 0):
    """Ink-pair frequency across logged matches — what to tune against."""
    where, params = ["m.opp_ink_1 IS NOT NULL"], []
    if store:
        where.append("e.store ILIKE %s")
        params.append(f"%{store}%")
    if last_events > 0:
        where.append("e.id IN (SELECT id FROM events ORDER BY date DESC, id DESC LIMIT %s)")
        params.append(last_events)
    return db.query(
        f"""SELECT least(m.opp_ink_1, coalesce(m.opp_ink_2, m.opp_ink_1)) || '/' ||
                   greatest(m.opp_ink_1, coalesce(m.opp_ink_2, m.opp_ink_1)) AS ink_pair,
                   count(*) AS times_faced,
                   count(*) FILTER (WHERE m.result IN ('1-2','0-2')) AS losses_to,
                   array_agg(DISTINCT m.opponent_handle)
                     FILTER (WHERE m.opponent_handle <> '') AS opponents
            FROM matches m JOIN events e ON e.id = m.event_id
            WHERE {' AND '.join(where)}
            GROUP BY 1 ORDER BY times_faced DESC, losses_to DESC""", params)


@router.get("/matchlog/stats")
def match_stats(deck_id: int = 0):
    """Aggregate win-rate analytics over the whole match log (optionally one
    deck): overall record, per-deck, play-vs-draw, game 1 vs games 2/3, loss
    modes, and opponent archetype shapes. Percentages are left to the client."""
    where, params = ["1=1"], []
    if deck_id:
        where.append("e.deck_id = %s")
        params.append(deck_id)
    w = " AND ".join(where)

    overall = db.query_one(
        f"""SELECT count(*) AS matches,
                   count(*) FILTER (WHERE m.result = ANY(%s)) AS wins,
                   count(*) FILTER (WHERE m.result = ANY(%s)) AS losses,
                   count(*) FILTER (WHERE m.result = 'DRAW') AS draws,
                   count(*) FILTER (WHERE m.result = 'BYE') AS byes,
                   count(DISTINCT e.id) AS events
            FROM matches m JOIN events e ON e.id = m.event_id WHERE {w}""",
        [list(WIN_RESULTS), list(LOSS_RESULTS)] + params)

    by_deck = db.query(
        f"""SELECT e.deck_id, d.name AS deck_name, count(DISTINCT e.id) AS events,
                   count(*) AS matches,
                   count(*) FILTER (WHERE m.result = ANY(%s)) AS wins,
                   count(*) FILTER (WHERE m.result = ANY(%s)) AS losses
            FROM matches m JOIN events e ON e.id = m.event_id
            LEFT JOIN decks d ON d.id = e.deck_id WHERE {w}
            GROUP BY e.deck_id, d.name ORDER BY count(*) DESC""",
        [list(WIN_RESULTS), list(LOSS_RESULTS)] + params)

    play_draw = db.query(
        f"""SELECT g.on_play, count(*) AS games,
                   count(*) FILTER (WHERE g.won) AS wins
            FROM games g JOIN matches m ON m.id = g.match_id
            JOIN events e ON e.id = m.event_id
            WHERE {w} AND g.on_play IS NOT NULL AND g.won IS NOT NULL
            GROUP BY g.on_play""", params)

    by_game_no = db.query(
        f"""SELECT g.game_no, count(*) AS games,
                   count(*) FILTER (WHERE g.won) AS wins
            FROM games g JOIN matches m ON m.id = g.match_id
            JOIN events e ON e.id = m.event_id
            WHERE {w} AND g.won IS NOT NULL
            GROUP BY g.game_no ORDER BY g.game_no""", params)

    loss_modes = db.query(
        f"""SELECT g.loss_mode, count(*) AS count
            FROM games g JOIN matches m ON m.id = g.match_id
            JOIN events e ON e.id = m.event_id
            WHERE {w} AND g.won = false AND g.loss_mode <> 'na'
            GROUP BY g.loss_mode ORDER BY count(*) DESC""", params)

    by_shape = db.query(
        f"""SELECT m.opp_shape, count(*) AS matches,
                   count(*) FILTER (WHERE m.result = ANY(%s)) AS wins,
                   count(*) FILTER (WHERE m.result = ANY(%s)) AS losses
            FROM matches m JOIN events e ON e.id = m.event_id
            WHERE {w} AND m.opp_shape <> 'unclear'
            GROUP BY m.opp_shape ORDER BY count(*) DESC""",
        [list(WIN_RESULTS), list(LOSS_RESULTS)] + params)

    return {
        "deck_id": deck_id or None, "overall": overall, "by_deck": by_deck,
        "play_draw": play_draw, "by_game_no": by_game_no,
        "loss_modes": loss_modes, "by_shape": by_shape,
    }


@router.get("/matchlog/cut-list")
def cut_list(deck_id: int):
    """Deck cards never recorded as my_mvp — the evidence-based cut list.
    Includes dead-card mention counts and how many logged events the deck has."""
    deck = db.query_one("SELECT id, name FROM decks WHERE id=%s", (deck_id,))
    if not deck:
        raise HTTPException(404, "no such deck")
    events_logged = db.query_one(
        "SELECT count(*) AS n FROM events WHERE deck_id=%s", (deck_id,))["n"]
    obs = db.query(
        """SELECT o.kind, lower(o.value) AS value FROM observations o
           LEFT JOIN matches m ON m.id = o.match_id
           JOIN events e ON e.id = coalesce(m.event_id, o.event_id)
           WHERE e.deck_id = %s AND o.kind IN ('my_mvp','my_dead_card','always_dead','never_drew')""",
        (deck_id,))
    mvp = {o["value"] for o in obs if o["kind"] == "my_mvp"}
    dead_counts: dict[str, int] = {}
    for o in obs:
        if o["kind"] in ("my_dead_card", "always_dead"):
            dead_counts[o["value"]] = dead_counts.get(o["value"], 0) + 1
    cards = db.query(
        """SELECT c.full_name, dc.qty FROM deck_cards dc JOIN cards c ON c.id = dc.card_id
           WHERE dc.deck_id=%s ORDER BY c.full_name""", (deck_id,))
    for c in cards:
        key = c["full_name"].lower()
        c["ever_mvp"] = key in mvp
        c["dead_mentions"] = dead_counts.get(key, 0)
    return {
        "deck_id": deck_id, "deck_name": deck["name"], "events_logged": events_logged,
        "never_mvp": [c for c in cards if not c["ever_mvp"]],
        "cards": cards,
    }


# --- duels.ink game logs (full turn data, persisted at import) ----------------

class DuelsLogIn(BaseModel):
    raw_log: str
    parsed: dict                       # {plays:{"1":{card:n},"2":{}}, quests, lore, ...}
    match_id: int | None = None
    event_id: int | None = None
    my_player: int | None = None
    winner: int | None = None
    first_player: int | None = None
    turns: int | None = None


@router.post("/duels/logs", status_code=201)
def add_duels_log(body: DuelsLogIn):
    from psycopg.types.json import Jsonb
    row = db.query_one(
        """INSERT INTO duels_game_logs
             (match_id, event_id, my_player, winner, first_player, turns, raw_log, parsed)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
        (body.match_id, body.event_id, body.my_player, body.winner,
         body.first_player, body.turns, body.raw_log, Jsonb(body.parsed)))
    return {"id": row["id"]}


@router.get("/duels/logs")
def list_duels_logs(limit: int = 100):
    return db.query(
        """SELECT id, imported_at, match_id, event_id, my_player, winner,
                  first_player, turns
           FROM duels_game_logs ORDER BY id DESC LIMIT %s""", (min(limit, 500),))


@router.get("/duels/logs/{log_id}")
def duels_log_detail(log_id: int):
    row = db.query_one("SELECT * FROM duels_game_logs WHERE id=%s", (log_id,))
    if not row:
        raise HTTPException(404, "no such log")
    return row


@router.get("/duels/coverage-priority")
def duels_coverage_priority():
    """Sim-engine authoring priority from REAL play: every card seen in stored
    duels.ink logs (both seats — the engine must play both sides), ranked by
    play frequency, split into engine-covered vs unspecced. Names that resolve
    to no catalog card land in `unmatched` (usually parser or promo quirks)."""
    logs = db.query("SELECT id, parsed FROM duels_game_logs")
    plays: dict[str, dict] = {}   # lower(name) -> {name, plays, games:set}
    for lg in logs:
        for seat in ("1", "2"):
            for name, n in ((lg["parsed"].get("plays") or {}).get(seat) or {}).items():
                e = plays.setdefault(name.lower(), {"name": name, "plays": 0, "games": set()})
                e["plays"] += int(n)
                e["games"].add(lg["id"])
    if not plays:
        return {"games": 0, "names_seen": 0, "covered": [], "unspecced": [], "unmatched": []}

    keys = list(plays)
    cards = db.query(
        """SELECT lower(c.full_name) AS fkey, lower(c.name) AS nkey, c.id,
                  c.full_name, s.code AS set_code, c.collector_number,
                  EXISTS (SELECT 1 FROM engine_coverage ec WHERE ec.card_id = c.id) AS covered
           FROM cards c JOIN sets s ON s.id = c.set_id
           WHERE lower(c.full_name) = ANY(%s) OR lower(c.name) = ANY(%s)
           ORDER BY s.released_at DESC NULLS LAST""", (keys, keys))
    by_key: dict[str, list] = {}
    for c in cards:
        by_key.setdefault(c["fkey"], []).append(c)
        by_key.setdefault(c["nkey"], []).append(c)

    covered, unspecced, unmatched = [], [], []
    for key, e in plays.items():
        cands = by_key.get(key)
        entry = {"name": e["name"], "plays": e["plays"], "games": len(e["games"])}
        if not cands:
            unmatched.append(entry)
            continue
        hit = next((c for c in cands if c["covered"]), None) or cands[0]
        entry.update({"card_id": hit["id"], "full_name": hit["full_name"],
                      "set_code": hit["set_code"],
                      "collector_number": hit["collector_number"]})
        (covered if hit["covered"] else unspecced).append(entry)
    for bucket in (covered, unspecced, unmatched):
        bucket.sort(key=lambda x: (-x["plays"], x["name"]))
    return {"games": len(logs), "names_seen": len(plays),
            "covered": covered, "unspecced": unspecced, "unmatched": unmatched}


class ScoutIn(BaseModel):
    inks: str                          # opponent ink pair, e.g. "Amber/Ruby" (or one ink)
    shape: str = ""                    # optional filter: lore_rush|aggro|midrange|control
    handle: str = ""                   # optional filter: specific opponent
    name: str = ""                     # deck name; default "RECON duels <inks> (AUTO)"
    save: bool = True
    covered_only: bool = True          # keep the deck simulatable-by-construction


@router.post("/duels/scout")
def scout_opponent_deck(body: ScoutIn):
    """Auto-draft a sim-only opponent skeleton from REAL duels.ink games:
    aggregate every card the opponent played across stored logs (filtered by
    ink pair / shape / handle), estimate copy counts (max plays seen in one
    game, capped at 4), and top up to 60 with observed-frequency bumps then
    deterministic covered filler. Re-running with the same name re-scouts in
    place, so sim history stays attached to the deck id."""
    want = {i.strip().capitalize() for i in body.inks.replace(",", "/").split("/") if i.strip()}
    if not want or not want <= {"Amber", "Amethyst", "Emerald", "Ruby", "Sapphire", "Steel"}:
        raise HTTPException(422, "inks must be 1-2 of Amber/Amethyst/Emerald/Ruby/Sapphire/Steel")

    logs = db.query(
        """SELECT g.id, g.parsed, g.my_player, m.opp_ink_1, m.opp_ink_2,
                  m.opp_shape, m.opponent_handle
           FROM duels_game_logs g JOIN matches m ON m.id = g.match_id
           WHERE g.my_player IS NOT NULL""")
    used = []
    for lg in logs:
        pair = {i for i in (lg["opp_ink_1"], lg["opp_ink_2"]) if i}
        if pair != want:
            continue
        if body.shape and (lg["opp_shape"] or "") != body.shape:
            continue
        if body.handle and (lg["opponent_handle"] or "").lower() != body.handle.lower():
            continue
        used.append(lg)
    if not used:
        raise HTTPException(404, f"no stored duels.ink games vs {'/'.join(sorted(want))}"
                                 + (f" shape={body.shape}" if body.shape else "")
                                 + (f" handle={body.handle}" if body.handle else ""))

    # Copy estimate: max simultaneous plays of a card in ONE game = at least
    # that many copies (recursion inflates this, hence the cap at 4).
    est: dict[str, dict] = {}
    for lg in used:
        opp = str(3 - lg["my_player"])
        for cname, n in ((lg["parsed"].get("plays") or {}).get(opp) or {}).items():
            e = est.setdefault(cname.lower(), {"name": cname, "qty": 0, "plays": 0, "games": 0})
            e["qty"] = min(4, max(e["qty"], int(n)))
            e["plays"] += int(n)
            e["games"] += 1

    keys = list(est)
    cands = db.query(
        """SELECT lower(c.full_name) AS fkey, lower(c.name) AS nkey, c.id, c.full_name,
                  EXISTS (SELECT 1 FROM engine_coverage ec WHERE ec.card_id = c.id) AS covered
           FROM cards c JOIN sets s ON s.id = c.set_id
           WHERE lower(c.full_name) = ANY(%s) OR lower(c.name) = ANY(%s)
           ORDER BY s.released_at DESC NULLS LAST""", (keys, keys)) if keys else []
    by_key: dict[str, list] = {}
    for c in cands:
        by_key.setdefault(c["fkey"], []).append(c)
        by_key.setdefault(c["nkey"], []).append(c)

    observed, excluded, unmatched = [], [], []
    for key, e in sorted(est.items(), key=lambda kv: (-kv[1]["plays"], kv[0])):
        hits = by_key.get(key)
        if not hits:
            unmatched.append(e["name"])
            continue
        hit = next((c for c in hits if c["covered"]), None)
        if hit is None:
            if body.covered_only:
                excluded.append(hits[0]["full_name"])
                continue
            hit = hits[0]
        observed.append({"card_id": hit["id"], "full_name": hit["full_name"],
                         "qty": e["qty"], "plays": e["plays"], "games": e["games"],
                         "covered": hit["covered"]})

    total = sum(c["qty"] for c in observed)
    bumped = 0
    for c in observed:                      # frequency order preserved from sort above
        while c["qty"] < 4 and total < 60:
            c["qty"] += 1
            bumped += 1
            total += 1
    filler = []
    if total < 60:
        pool = db.query(
            """SELECT c.id, c.full_name FROM cards c
               JOIN engine_coverage ec ON ec.card_id = c.id
               JOIN sets s ON s.id = c.set_id
               WHERE s.core_legal AND c.inkwell
                 AND 'Character' = ANY(c.type)
                 AND COALESCE(c.inks, ARRAY[c.ink]) <@ %s::text[]
                 AND c.id != ALL(%s)
               ORDER BY c.cost NULLS LAST, c.id LIMIT 30""",
            (sorted(want), [c["card_id"] for c in observed] or [""]))
        for c in pool:
            if total >= 60:
                break
            q = min(4, 60 - total)
            filler.append({"card_id": c["id"], "full_name": c["full_name"], "qty": q})
            total += q

    result = {"inks": "/".join(sorted(want)), "games_used": len(used),
              "observed": observed, "bumped_copies": bumped, "filler": filler,
              "excluded_unspecced": excluded, "unmatched": unmatched,
              "card_total": total, "saved": False}
    if not body.save:
        return result

    if total < 60:
        raise HTTPException(422, f"only {total} covered copies available — not enough "
                                 "for a 60-card skeleton (spec more cards, or save=false to preview)")
    name = body.name or f"RECON duels {'/'.join(sorted(want))} (AUTO)"
    notes = (f"Auto-scouted from {len(used)} duels.ink game(s)"
             + (f" vs {body.handle}" if body.handle else "")
             + f"; {sum(c['qty'] for c in observed)}/60 observed"
             + (f", {len(excluded)} unspecced excluded" if excluded else ""))
    with db.pool.connection() as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO decks (name, notes, created_source, format, sim_only)
               VALUES (%s,%s,'scout','constructed',true)
               ON CONFLICT (name) DO UPDATE
               SET notes=EXCLUDED.notes, updated_at=now(), updated_source='scout'
               RETURNING id""", (name, notes))
        deck_id = cur.fetchone()["id"]
        cur.execute("DELETE FROM deck_cards WHERE deck_id=%s", (deck_id,))
        for c in observed + filler:
            cur.execute("INSERT INTO deck_cards (deck_id, card_id, qty) VALUES (%s,%s,%s)",
                        (deck_id, c["card_id"], c["qty"]))
        cur.execute("INSERT INTO deck_events (deck_id, action, detail) VALUES (%s,'scouted',%s)",
                    (deck_id, notes))
        conn.commit()
    result.update({"saved": True, "deck_id": deck_id, "deck_name": name})
    return result


# --- replay validation (step 2 interface: engine replays real games) ----------

@router.get("/duels/replay-corpus")
def replay_corpus(replayable_only: bool = False, limit: int = 200):
    """Real-game corpus for the engine's replay validator. Each stored log
    plus a card map (log name -> catalog card + engine coverage) and a
    `replayable` flag (every played name matched AND covered). The engine
    checks each public action against legal_actions() and the log's lore
    arithmetic, then POSTs a verdict per game to /duels/replay-validations."""
    logs = db.query(
        """SELECT g.id, g.raw_log, g.parsed, g.my_player, g.winner,
                  g.first_player, g.turns,
                  (SELECT jsonb_agg(jsonb_build_object(
                      'engine_build', rv.engine_build, 'ok', rv.ok,
                      'validated_at', rv.validated_at))
                   FROM replay_validations rv WHERE rv.log_id = g.id) AS validations
           FROM duels_game_logs g ORDER BY g.id LIMIT %s""", (min(limit, 1000),))
    names = sorted({n.lower()
                    for lg in logs for seat in ("1", "2")
                    for n in ((lg["parsed"].get("plays") or {}).get(seat) or {})})
    cards = db.query(
        """SELECT lower(c.full_name) AS fkey, lower(c.name) AS nkey, c.id, c.full_name,
                  EXISTS (SELECT 1 FROM engine_coverage ec WHERE ec.card_id = c.id) AS covered
           FROM cards c JOIN sets s ON s.id = c.set_id
           WHERE lower(c.full_name) = ANY(%s) OR lower(c.name) = ANY(%s)
           ORDER BY s.released_at DESC NULLS LAST""", (names, names)) if names else []
    by_key: dict[str, list] = {}
    for c in cards:
        by_key.setdefault(c["fkey"], []).append(c)
        by_key.setdefault(c["nkey"], []).append(c)
    out = []
    for lg in logs:
        card_map, replayable = {}, True
        for seat in ("1", "2"):
            for n in ((lg["parsed"].get("plays") or {}).get(seat) or {}):
                hits = by_key.get(n.lower())
                hit = (next((c for c in hits if c["covered"]), None) or hits[0]) if hits else None
                if hit is None:
                    card_map[n] = None
                    replayable = False
                else:
                    card_map[n] = {"card_id": hit["id"], "full_name": hit["full_name"],
                                   "covered": hit["covered"]}
                    replayable = replayable and hit["covered"]
        if replayable_only and not replayable:
            continue
        out.append({**lg, "card_map": card_map, "replayable": replayable})
    return {"games": len(out), "corpus": out}


class ReplayValidationIn(BaseModel):
    log_id: int
    engine_build: str
    ok: bool
    actions_checked: int | None = None
    divergences: list[dict] = []


@router.post("/duels/replay-validations", status_code=201)
def post_replay_validation(body: ReplayValidationIn):
    from psycopg.types.json import Jsonb
    if not db.query_one("SELECT 1 FROM duels_game_logs WHERE id=%s", (body.log_id,)):
        raise HTTPException(404, "no such log")
    row = db.query_one(
        """INSERT INTO replay_validations
             (log_id, engine_build, ok, actions_checked, divergences)
           VALUES (%s,%s,%s,%s,%s)
           ON CONFLICT (log_id, engine_build) DO UPDATE
           SET ok=EXCLUDED.ok, actions_checked=EXCLUDED.actions_checked,
               divergences=EXCLUDED.divergences, validated_at=now()
           RETURNING id""",
        (body.log_id, body.engine_build, body.ok, body.actions_checked,
         Jsonb(body.divergences)))
    return {"id": row["id"]}


@router.get("/duels/replay-status")
def replay_status():
    """Replay-validation health per engine build: how many real games replay
    clean, and the currently-open divergences (each one is an engine bug or a
    mis-specced card, found by a real game)."""
    total = db.query_one("SELECT count(*) AS n FROM duels_game_logs")["n"]
    builds = db.query(
        """SELECT engine_build, count(*) AS validated,
                  count(*) FILTER (WHERE ok) AS ok,
                  max(validated_at) AS last_run
           FROM replay_validations GROUP BY engine_build
           ORDER BY max(validated_at) DESC""")
    diverged = db.query(
        """SELECT rv.log_id, rv.engine_build, rv.divergences, g.match_id
           FROM replay_validations rv
           JOIN duels_game_logs g ON g.id = rv.log_id
           WHERE NOT rv.ok
           ORDER BY rv.validated_at DESC LIMIT 20""")
    return {"logs_total": total, "builds": builds, "diverged": diverged}
