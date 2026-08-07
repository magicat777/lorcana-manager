"""lorcana-brief: daily digest assembled from live data.

Sections: tonight's league nights (venues.event_night — one source of truth
with the match-log dropdown), the week's schedule, last-event recap (with the
one-change reminder), local meta from recent matches, deck watch signals, price
movers on owned cards (needs >=2 weekly snapshots), official news (news_items,
fetched daily by app.jobs.fetch_news — new-in-36h items make the text push),
and collection totals."""
from datetime import date, datetime
from zoneinfo import ZoneInfo

from .. import config, db

TZ = ZoneInfo("America/Los_Angeles")
WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


def build_brief() -> dict:
    now = datetime.now(TZ)
    today = WEEKDAYS[now.weekday()]

    schedule = db.query(
        """SELECT slug, display_name, event_night, event_time FROM venues
           WHERE active AND event_night IS NOT NULL
           ORDER BY array_position(%s::text[], lower(event_night)), event_time""",
        (WEEKDAYS,))
    tonight = [v for v in schedule if v["event_night"].lower() == today]

    last_event = db.query_one(
        """SELECT e.id, e.date, e.store, e.final_record, e.one_change, e.biggest_problem,
                  e.deck_id, d.name AS deck_name, (current_date - e.date) AS days_ago
           FROM events e LEFT JOIN decks d ON d.id = e.deck_id
           ORDER BY e.date DESC, e.id DESC LIMIT 1""")
    if last_event and not last_event["final_record"]:
        ms = db.query("SELECT result FROM matches WHERE event_id=%s", (last_event["id"],))
        w = sum(1 for m in ms if m["result"] in ("2-0", "2-1", "BYE"))
        l = sum(1 for m in ms if m["result"] in ("1-2", "0-2"))
        last_event["final_record"] = f"{w}-{l}"

    meta = db.query(
        """SELECT least(m.opp_ink_1, coalesce(m.opp_ink_2, m.opp_ink_1)) || '/' ||
                  greatest(m.opp_ink_1, coalesce(m.opp_ink_2, m.opp_ink_1)) AS ink_pair,
                  count(*) AS times_faced,
                  count(*) FILTER (WHERE m.result IN ('1-2','0-2')) AS losses_to
           FROM matches m
           WHERE m.opp_ink_1 IS NOT NULL
             AND m.event_id IN (SELECT id FROM events ORDER BY date DESC, id DESC LIMIT 5)
           GROUP BY 1 ORDER BY times_faced DESC, losses_to DESC LIMIT 5""")

    deck_watch = []
    if last_event and last_event["deck_id"]:
        deck_watch = db.query(
            """SELECT o.value, count(*) AS mentions FROM observations o
               LEFT JOIN matches m ON m.id = o.match_id
               JOIN events e ON e.id = coalesce(m.event_id, o.event_id)
               WHERE e.deck_id = %s AND o.kind IN ('my_dead_card','always_dead')
               GROUP BY o.value ORDER BY mentions DESC LIMIT 5""",
            (last_event["deck_id"],))

    movers = db.query(
        """WITH snaps AS (
             SELECT ph.card_id, ph.usd, ph.captured_at,
                    row_number() OVER (PARTITION BY ph.card_id ORDER BY ph.captured_at DESC) AS rn
             FROM price_history ph
             JOIN collection col ON col.card_id = ph.card_id
             WHERE col.qty_normal + col.qty_foil > 0)
           SELECT c.full_name, cur.usd AS price_now, prev.usd AS price_prev,
                  (cur.usd - prev.usd) AS delta
           FROM snaps cur JOIN snaps prev ON prev.card_id = cur.card_id AND prev.rn = 2
           JOIN cards c ON c.id = cur.card_id
           WHERE cur.rn = 1 AND cur.usd IS NOT NULL AND prev.usd IS NOT NULL
             AND abs(cur.usd - prev.usd) >= 0.50
           ORDER BY abs(cur.usd - prev.usd) DESC LIMIT 8""")

    sim_lab = db.query(
        """SELECT engine_build, matchup, games, p0_wins, p1_wins, avg_turns
           FROM sim_results
           WHERE run_at = (SELECT max(run_at) FROM sim_results)
             AND run_at > now() - interval '36 hours'
           ORDER BY id""")

    rotation = None
    if config.NEXT_ROTATION:
        try:
            rot_date = date.fromisoformat(config.NEXT_ROTATION)
            core = db.query_one(
                """SELECT min(set_num) AS lo, max(set_num) AS hi
                   FROM sets WHERE core_legal""")
            rotation = {
                "date": rot_date.isoformat(),
                "days": (rot_date - now.date()).days,
                "core_sets": f"{core['lo']}–{core['hi']}" if core and core["lo"] else "?",
            }
        except ValueError:
            pass

    news = db.query(
        """SELECT title, url, category, summary, published_at, signal,
                  (first_seen_at > now() - interval '36 hours') AS is_new
           FROM news_items
           ORDER BY (signal IS NOT NULL AND first_seen_at > now() - interval '7 days') DESC,
                    published_at DESC NULLS LAST, id DESC LIMIT 8""")

    conflicts = db.query(
        """SELECT c.full_name, sum(dc.qty) AS claimed,
                  COALESCE(col.qty_normal + col.qty_foil, 0) AS owned
           FROM deck_cards dc
           JOIN decks d ON d.id = dc.deck_id AND d.in_use AND d.format = 'constructed'
           JOIN cards c ON c.id = dc.card_id
           LEFT JOIN collection col ON col.card_id = c.id
           GROUP BY c.id, c.full_name, col.qty_normal, col.qty_foil
           HAVING sum(dc.qty) > COALESCE(col.qty_normal + col.qty_foil, 0)
           ORDER BY c.full_name LIMIT 6""")

    totals = db.query_one(
        """SELECT count(*) FILTER (WHERE col.qty_normal + col.qty_foil > 0) AS unique_owned,
                  COALESCE(sum(col.qty_normal + col.qty_foil), 0) AS total_copies,
                  COALESCE(sum(col.qty_normal * c.price_usd + col.qty_foil * c.price_usd_foil), 0)
                    ::numeric(12,2) AS value
           FROM collection col JOIN cards c ON c.id = col.card_id""")

    return {
        "generated_at": now.isoformat(),
        "today": {"weekday": today, "date": now.date().isoformat()},
        "tonight": tonight,
        "week_schedule": schedule,
        "rotation": rotation,
        "news": news,
        "last_event": last_event,
        "meta_last5": meta,
        "sim_lab": sim_lab,
        "deck_watch": deck_watch,
        "allocation_conflicts": conflicts,
        "price_movers": movers,
        "collection": totals,
    }


def render_text(b: dict) -> str:
    lines = [f"◈ Lorcana Brief — {b['today']['weekday'].capitalize()} {b['today']['date']}"]
    if b["tonight"]:
        for v in b["tonight"]:
            t = f" at {v['event_time']}" if v["event_time"] else ""
            lines.append(f"TONIGHT: league at {v['display_name']}{t}")
    elif b["week_schedule"]:
        nxt = b["week_schedule"][0]
        lines.append(f"No league tonight. This week: "
                     + "; ".join(f"{v['event_night']} {v['display_name']}" for v in b["week_schedule"]))
    else:
        lines.append("No venue league nights recorded yet — set event_night on venues to see them here.")
    rot = b.get("rotation")
    if rot and 0 <= rot["days"] <= 90:
        lines.append(f"⚠ Core rotation in {rot['days']}d ({rot['date']}) — "
                     f"Core is currently sets {rot['core_sets']}; recheck deck legality.")
    fresh = sorted([n for n in b.get("news", []) if n["is_new"]],
                   key=lambda n: n.get("signal") is None)
    if fresh:
        lines.append("Official news: "
                     + "; ".join(("⚠ " if n.get("signal") else "") + f"{n['title']} [{n['category']}]"
                                 for n in fresh[:5]))
    le = b["last_event"]
    if le:
        lines.append(f"Last event: {le['date']} {le['store']} — went {le['final_record'] or '?'}"
                     f"{' with ' + le['deck_name'] if le['deck_name'] else ''} ({le['days_ago']}d ago).")
        if le["one_change"]:
            lines.append(f"  Your one change for next week: {le['one_change']}")
        if le["biggest_problem"]:
            lines.append(f"  Biggest problem was: {le['biggest_problem']}")
    if b["meta_last5"]:
        lines.append("Local meta (last 5 events): "
                     + "; ".join(f"{m['ink_pair']} x{m['times_faced']}"
                                 + (f" ({m['losses_to']}L)" if m["losses_to"] else "")
                                 for m in b["meta_last5"]))
    if b.get("sim_lab"):
        parts = []
        for s in b["sim_lab"]:
            decks_part, _, pol = s["matchup"].partition("+")
            pct = 100 * s["p0_wins"] / s["games"]
            parts.append(f"{decks_part} ({pol or 'random'}): P0 {pct:.1f}% of {s['games']}")
        lines.append(f"Sim lab overnight [{b['sim_lab'][0]['engine_build']}]: "
                     + "; ".join(parts))
    if b["deck_watch"]:
        lines.append("Deck watch — dead-card mentions: "
                     + ", ".join(f"{d['value']} x{d['mentions']}" for d in b["deck_watch"]))
    if b.get("allocation_conflicts"):
        lines.append("⚠ Built decks claim more copies than owned: "
                     + "; ".join(f"{c['full_name']} ({c['claimed']} claimed, own {c['owned']})"
                                 for c in b["allocation_conflicts"])
                     + " — fix the decks or collection counts.")
    if b["price_movers"]:
        lines.append("Price movers (owned): "
                     + "; ".join(f"{m['full_name']} {'+' if m['delta'] >= 0 else ''}{m['delta']}"
                                 f" → ${m['price_now']}" for m in b["price_movers"]))
    c = b["collection"]
    lines.append(f"Collection: {c['unique_owned']} unique / {c['total_copies']} copies, ~${c['value']}.")
    return "\n".join(lines)
