"""lorcana-brief: daily digest assembled from live data.

Sections: tonight's league nights (venues.event_night — one source of truth
with the match-log dropdown), the week's schedule, last-event recap (with the
one-change reminder), local meta from recent matches, deck watch signals, price
movers on owned cards (needs >=2 daily snapshots), official news (news_items,
fetched daily by app.jobs.fetch_news — new-in-36h items make the text push),
and collection totals."""
from datetime import date, datetime
from zoneinfo import ZoneInfo

from .. import config, db

TZ = ZoneInfo("America/Los_Angeles")
WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]

# Market-signal thresholds. CI (competitive index) = a single's price vs its
# own 30-day average — play demand. SP (sealed premium) = sealed price vs
# MSRP — speculation/supply. SP climbing while CI sits still = scalped box.
CI_MOMENTUM = 1.10   # single up ≥10% on its 30d avg → players are buying
CI_DIP = 0.90        # single down ≥10% → buy-the-dip candidate
SP_HIGH = 1.15       # sealed ≥15% over MSRP counts as a premium
SP_FLAT_TOL = 0.05   # week-over-week sealed move under 5% counts as flat
MIN_SNAPSHOTS_30D = 5  # snapshots needed before a CI is trustworthy
MIN_TRIGGER_PRICE = 1.00  # CI triggers need a real price: a $0.04→$0.05 tick
                          # is a 25% "move" on a bulk common, not demand


def _market_signals() -> dict:
    """SP×CI quadrant per sealed SKU + buy triggers on want-list singles.

    Sealed observations are hand-logged (no scrapeable sealed source); singles
    ride the nightly price_history. "Want-list" = manual want-list entries plus
    the deck-derived shopping list (wanted, not-built constructed decks whose
    cards fall short of owned copies, minus wantlist_skips).
    """
    singles = db.query(
        """WITH wl AS (
             SELECT card_id FROM want_list_cards
             UNION
             (SELECT dc.card_id
              FROM deck_cards dc
              JOIN decks d ON d.id = dc.deck_id
                AND d.wanted AND NOT d.in_use AND NOT d.sim_only
                AND d.format = 'constructed'
              LEFT JOIN collection col ON col.card_id = dc.card_id
              GROUP BY dc.card_id, col.qty_normal, col.qty_foil
              HAVING sum(dc.qty) > COALESCE(col.qty_normal, 0) + COALESCE(col.qty_foil, 0)
              EXCEPT
              SELECT card_id FROM wantlist_skips)),
           hist AS (
             SELECT ph.card_id, avg(ph.usd) AS avg30, count(*) AS n30
             FROM price_history ph JOIN wl ON wl.card_id = ph.card_id
             WHERE ph.captured_at > now() - interval '30 days'
               AND ph.usd IS NOT NULL
             GROUP BY ph.card_id)
           SELECT c.full_name, s.code AS set_code, c.collector_number,
                  c.price_usd, h.avg30, h.n30,
                  s.core_legal, s.released_at
           FROM wl JOIN cards c ON c.id = wl.card_id
           JOIN sets s ON s.id = c.set_id
           LEFT JOIN hist h ON h.card_id = c.id
           WHERE c.price_usd IS NOT NULL""")

    today = datetime.now(TZ).date()
    horizon_days = int(config.ROTATION_HORIZON_YEARS * 365.25)
    rows = []
    for r in singles:
        price = float(r["price_usd"])
        ci = round(price / float(r["avg30"]), 3) \
            if r["n30"] and r["n30"] >= MIN_SNAPSHOTS_30D and float(r["avg30"]) > 0 else None
        ceiling = weeks_left = None
        if r["core_legal"] and r["released_at"]:
            days = (r["released_at"] - today).days + horizon_days
            weeks_left = max(0, days // 7)
            ceiling = round(config.WEEKLY_BUDGET_USD * weeks_left, 2)
        trigger = None
        priced = ci is not None and float(r["avg30"]) >= MIN_TRIGGER_PRICE
        if ci is not None and ceiling is not None \
                and float(r["avg30"]) > ceiling >= price:
            trigger = "buy"       # crossed under its budget ceiling
        elif priced and ci >= CI_MOMENTUM:
            trigger = "momentum"  # players buying — confirm sealed is flat below
        elif priced and ci <= CI_DIP:
            trigger = "dip"       # softening (new-set hype drain) — buy if still playable
        rows.append({
            "full_name": r["full_name"], "set_code": r["set_code"],
            "collector_number": r["collector_number"], "price": price,
            "avg30": round(float(r["avg30"]), 2) if r["avg30"] is not None else None,
            "ci": ci, "ceiling": ceiling, "weeks_left": weeks_left,
            "trigger": trigger,
        })
    rows.sort(key=lambda x: (x["trigger"] is None, -abs((x["ci"] or 1) - 1)))

    # Median CI per set — the "are this set's singles actually moving" number
    # each sealed SKU is judged against.
    set_ci: dict[str, float] = {}
    for code in {x["set_code"] for x in rows}:
        cis = sorted(x["ci"] for x in rows if x["set_code"] == code and x["ci"] is not None)
        if cis:
            set_ci[code] = cis[len(cis) // 2]

    sealed = db.query(
        """SELECT p.id, p.name, p.set_code, p.kind, p.msrp,
                  cur.price, cur.observed_at, prev.price AS prev_price
           FROM sealed_products p
           JOIN LATERAL (
             SELECT price, observed_at FROM sealed_price_obs
             WHERE product_id = p.id ORDER BY observed_at DESC LIMIT 1) cur ON true
           LEFT JOIN LATERAL (
             SELECT price FROM sealed_price_obs
             WHERE product_id = p.id
               AND observed_at <= cur.observed_at - interval '5 days'
             ORDER BY observed_at DESC LIMIT 1) prev ON true
           WHERE p.active ORDER BY p.set_code DESC NULLS LAST, p.name""")
    sealed_out = []
    for s in sealed:
        sp = round(float(s["price"]) / float(s["msrp"]), 2)
        sp_wow = round((float(s["price"]) - float(s["prev_price"])) / float(s["prev_price"]), 3) \
            if s["prev_price"] else None
        ci = set_ci.get(s["set_code"])
        sp_high = sp >= SP_HIGH
        ci_rising = ci is not None and ci >= CI_MOMENTUM
        if ci is None:
            quadrant = "scalped?" if sp_high else "quiet"
            reason = "no tracked singles in this set — add want-list cards to read demand"
        elif sp_high and ci_rising:
            quadrant, reason = "hot", "real demand — singles will follow the box, buy yours today"
        elif sp_high:
            quadrant, reason = "scalped", "box premium without single demand — buy singles, ignore sealed"
        elif ci_rising:
            quadrant, reason = "sealed value", "box near MSRP while its cards heat up — rare good sealed buy"
        else:
            quadrant, reason = "quiet", "nothing to do"
        sealed_out.append({
            "id": s["id"], "name": s["name"], "set_code": s["set_code"],
            "kind": s["kind"], "msrp": float(s["msrp"]), "price": float(s["price"]),
            "observed_at": s["observed_at"].astimezone(TZ).date().isoformat(),
            "sp": sp, "sp_wow": sp_wow, "set_ci": ci,
            "quadrant": quadrant, "reason": reason,
        })

    # The momentum trigger is only a scalper-vs-demand divergence when the
    # set's sealed premium is flat (or untracked) that same week.
    sealed_flat = {s["set_code"]: (s["sp_wow"] is None or abs(s["sp_wow"]) < SP_FLAT_TOL)
                   for s in sealed_out if s["set_code"]}
    for x in rows:
        if x["trigger"] == "momentum" and sealed_flat.get(x["set_code"]) is False:
            x["trigger"] = "hot-set"  # box moving too — demand is real but priced in

    return {"sealed": sealed_out, "singles": rows[:12],
            "params": {"weekly_budget_usd": config.WEEKLY_BUDGET_USD,
                       "rotation_horizon_years": config.ROTATION_HORIZON_YEARS}}


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
                  -- per-price COALESCE: qty * NULL nulls the row and silently
                  -- drops foil-only Enchanteds from the total
                  COALESCE(sum(col.qty_normal * COALESCE(c.price_usd, 0)
                    + col.qty_foil * COALESCE(c.price_usd_foil, 0)), 0)
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
        "market": _market_signals(),
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
    mkt = b.get("market") or {}
    for s in mkt.get("sealed", []):
        lines.append(f"Market: {s['name']} ${s['price']:.0f} = {s['sp']:.2f}× MSRP"
                     + (f", set CI {s['set_ci']:.2f}" if s["set_ci"] is not None else "")
                     + f" — {s['quadrant'].upper()}: {s['reason']}")
    TRIGGER_LINE = {
        "buy": "🛒 BUY {n} at ${p:.2f} — crossed under its ${ceil:.0f} ceiling ({w}w of Core left)",
        "momentum": "↗ {n} CI {ci:.2f} while sealed sits flat — players are buying, get in early",
        "dip": "▼ {n} CI {ci:.2f} — softening; buy the dip if it stays playable",
        "hot-set": "🔥 {n} CI {ci:.2f} and the box is moving too — demand real but priced in",
    }
    for x in mkt.get("singles", []):
        if x["trigger"]:
            lines.append(TRIGGER_LINE[x["trigger"]].format(
                n=x["full_name"], p=x["price"], ci=x["ci"] or 0,
                ceil=x["ceiling"] or 0, w=x["weeks_left"]))
    if b["price_movers"]:
        lines.append("Price movers (owned): "
                     + "; ".join(f"{m['full_name']} {'+' if m['delta'] >= 0 else ''}{m['delta']}"
                                 f" → ${m['price_now']}" for m in b["price_movers"]))
    c = b["collection"]
    lines.append(f"Collection: {c['unique_owned']} unique / {c['total_copies']} copies, ~${c['value']}.")
    return "\n".join(lines)
