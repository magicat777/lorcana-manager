"""duels.ink account-ledger import (docs/ODIN_duels_ledger_replay_handoff.md).

The ledger CSV is the COMPLETE record of duels games; pasted text logs cover
a biased subset (wins 18/32, losses 10/43 at discovery). This importer
upserts `duels_games` on game_id (re-import is a no-op for unchanged rows,
never deletes), snapshots deck versions, and links rows to already-logged
match rounds through the stored game logs' lore fingerprints — ambiguity is
reported, never guessed.

Privacy: your_user_id is dropped on parse. opp_display_name is stored for
Jason's own analysis but must stay out of shared surfaces.
"""
import csv
import hashlib
import io
import json
from datetime import datetime
from zoneinfo import ZoneInfo

from .. import db

PT = ZoneInfo("America/Los_Angeles")
TRIVIAL_TURNS = 2   # <=2 duels turns (e.g. a turn-1 concede) — ledger keeps
                    # the row; rate metrics exclude it by default


def _ts(v: str) -> datetime | None:
    if not v:
        return None
    return datetime.fromisoformat(v.replace("Z", "+00:00"))


def _resolve_decklist(cur, decklist_json: str):
    """duels cardId ('2-27' = FIRST printing set-num/number) -> oracle name.
    Returns (entries, unresolved): entries are {duels_id, name, count}."""
    entries, unresolved = [], []
    try:
        lst = json.loads(decklist_json) if decklist_json else []
    except json.JSONDecodeError:
        return [], ["<unparseable decklist json>"]
    for e in lst:
        cid, count = str(e.get("cardId", "")), int(e.get("count", 0))
        set_part, _, num = cid.partition("-")
        row = None
        if set_part.isdigit() and num:
            cur.execute(
                """SELECT c.full_name FROM cards c JOIN sets s ON s.id = c.set_id
                   WHERE s.set_num = %s AND c.collector_number = %s""",
                (int(set_part), num))
            row = cur.fetchone()
        if row:
            entries.append({"duels_id": cid, "name": row["full_name"], "count": count})
        else:
            unresolved.append(cid)
    return entries, unresolved


def _version_hash(entries) -> str:
    ident = sorted((e["name"], e["count"]) for e in entries)
    return hashlib.sha1(json.dumps(ident).encode()).hexdigest()


def snapshot_deck_version(cur, deck_id: int | None, entries, source: str) -> str | None:
    if not entries:
        return None
    h = _version_hash(entries)
    cur.execute(
        """INSERT INTO deck_versions (hash, deck_id, list_json, source)
           VALUES (%s, %s, %s, %s)
           ON CONFLICT (hash) DO UPDATE SET last_seen = now(),
             deck_id = COALESCE(deck_versions.deck_id, EXCLUDED.deck_id)""",
        (h, deck_id, json.dumps(entries), source))
    return h


def import_history(csv_text: str, source_file: str = "upload") -> dict:
    added = updated = linked = 0
    unresolved_cards: set[str] = set()
    unmapped_decks: set[str] = set()
    ambiguous_links: list[dict] = []

    with db.pool.connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT duels_deck_id, deck_id FROM duels_deck_map")
        deck_map = {r["duels_deck_id"]: r["deck_id"] for r in cur.fetchall()}

        # lore fingerprints of already-logged rounds, via stored game logs:
        # (event PT date, my lore, opp lore, won?) -> match_id
        cur.execute(
            """SELECT gl.match_id, gl.my_player, gl.winner,
                      gl.parsed->'lore' AS lore, e.date AS event_date
               FROM duels_game_logs gl
               JOIN matches m ON m.id = gl.match_id
               JOIN events e ON e.id = m.event_id
               WHERE gl.match_id IS NOT NULL""")
        prints: dict[tuple, list[int]] = {}
        for r in cur.fetchall():
            lore = r["lore"] or {}
            me = str(r["my_player"])
            opp = "2" if me == "1" else "1"
            key = (r["event_date"], int(lore.get(me, -1)), int(lore.get(opp, -1)),
                   r["winner"] == r["my_player"])
            prints.setdefault(key, []).append(r["match_id"])

        for row in csv.DictReader(io.StringIO(csv_text)):
            gid = row.get("game_id", "").strip()
            if not gid:
                continue
            started = _ts(row["started_at"])
            ended = _ts(row["ended_at"]) or started
            played_pt = started.astimezone(PT).date()
            result = row["result"].strip().lower()
            end_reason = (row.get("end_reason") or "").strip().lower() or None
            conceded_by = None
            if end_reason == "concede":
                conceded_by = "me" if result == "loss" else "opponent"
            mode = row["mode"].strip().lower()
            ranked = (row.get("ranked") or "").strip().lower() in ("true", "1", "t")
            opp_is_bot = (row.get("opp_is_bot") or "").strip().lower() in ("true", "1", "t")
            opp_kind = ("bot" if (mode == "bot" or opp_is_bot)
                        else "pvp_ranked" if ranked else "pvp_casual")
            inks = [i for i in (row.get("opp_deck_colors") or "").split("/") if i]
            inks = sorted(set(inks))
            opp_ink_1 = inks[0] if inks else None
            opp_ink_2 = inks[1] if len(inks) > 1 else None
            turns = int(row["turns"]) if (row.get("turns") or "").strip() else None
            duels_deck_id = (row.get("your_deck_id") or "").strip() or None
            deck_id = deck_map.get(duels_deck_id)
            if duels_deck_id and deck_id is None:
                unmapped_decks.add(duels_deck_id)

            entries, unres = _resolve_decklist(cur, row.get("your_decklist") or "")
            unresolved_cards.update(unres)
            vhash = snapshot_deck_version(cur, deck_id, entries, "duels-ledger")

            def _i(k):
                v = (row.get(k) or "").strip()
                return int(v) if v.lstrip("-").isdigit() else None

            match_row_id = None
            if result in ("win", "loss") and _i("your_lore") is not None:
                key = (played_pt, _i("your_lore"), _i("opp_lore"), result == "win")
                cands = prints.get(key, [])
                if len(cands) == 1:
                    match_row_id = cands[0]
                elif len(cands) > 1:
                    ambiguous_links.append({"game_id": gid, "candidates": cands})

            cur.execute(
                """INSERT INTO duels_games (game_id, mode, queue_id, queue_name,
                     season_name, match_format, duels_match_id, match_game_number,
                     ranked, started_at, ended_at, played_on_pt, duration_seconds,
                     duels_turns, result, end_reason, conceded_by, your_player,
                     went_first, your_lore, opp_lore, mmr_before, mmr_after,
                     mmr_delta, is_placement, duels_deck_id, deck_id,
                     deck_version_hash, your_deck_colors, opp_display_name,
                     opp_is_bot, opp_guest, opp_ink_1, opp_ink_2, opp_kind,
                     replay_id, gamelog_id, match_row_id, is_trivial, source_file)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                           %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                           %s,%s,%s,%s,%s)
                   ON CONFLICT (game_id) DO UPDATE SET
                     mmr_before = EXCLUDED.mmr_before,
                     mmr_after = EXCLUDED.mmr_after,
                     mmr_delta = EXCLUDED.mmr_delta,
                     deck_id = COALESCE(duels_games.deck_id, EXCLUDED.deck_id),
                     match_row_id = COALESCE(duels_games.match_row_id,
                                             EXCLUDED.match_row_id),
                     replay_id = COALESCE(duels_games.replay_id, EXCLUDED.replay_id),
                     gamelog_id = COALESCE(duels_games.gamelog_id, EXCLUDED.gamelog_id)
                   RETURNING (xmax = 0) AS inserted""",
                (gid, mode, (row.get("queue_id") or "").strip() or None,
                 (row.get("queue_name") or "").strip() or None,
                 (row.get("season_name") or "").strip() or None,
                 (row.get("match_format") or "").strip() or None,
                 (row.get("match_id") or "").strip() or None,
                 _i("match_game_number"), ranked, started, ended, played_pt,
                 _i("duration_seconds"), turns, result, end_reason, conceded_by,
                 _i("your_player"),
                 (row.get("went_first") or "").strip().lower() in ("true", "1", "t"),
                 _i("your_lore"), _i("opp_lore"), _i("mmr_before"),
                 _i("mmr_after"), _i("mmr_delta"),
                 (row.get("is_placement") or "").strip().lower() in ("true", "1", "t"),
                 duels_deck_id, deck_id, vhash,
                 (row.get("your_deck_colors") or "").strip() or None,
                 (row.get("opp_display_name") or "").strip() or None,
                 opp_is_bot,
                 (row.get("opp_guest") or "").strip().lower() in ("true", "1", "t"),
                 opp_ink_1, opp_ink_2, opp_kind,
                 (row.get("replay_id") or "").strip() or None,
                 (row.get("gamelog_id") or "").strip() or None,
                 match_row_id,
                 turns is not None and turns <= TRIVIAL_TURNS,
                 source_file))
            if cur.fetchone()["inserted"]:
                added += 1
            else:
                updated += 1
            if match_row_id:
                linked += 1
        # pass 2 (handoff §2.2's own method): unlinked rows -> match rows by
        # (event date, deck, single-game result), only when exactly one
        # unclaimed candidate exists — shorthand-logged rounds have no
        # stored log for the lore-fingerprint pass to hit
        cur.execute(
            """SELECT g.game_id, g.played_on_pt, g.deck_id, g.result
               FROM duels_games g
               WHERE g.match_row_id IS NULL AND g.result IN ('win','loss')
                 AND g.deck_id IS NOT NULL""")
        for g in cur.fetchall():
            want = '1-0' if g["result"] == 'win' else '0-1'
            cur.execute(
                """SELECT m.id FROM matches m JOIN events e ON e.id = m.event_id
                   WHERE e.date = %s AND e.deck_id = %s AND m.result = %s
                     AND NOT EXISTS (SELECT 1 FROM duels_games g2
                                     WHERE g2.match_row_id = m.id)""",
                (g["played_on_pt"], g["deck_id"], want))
            c = cur.fetchall()
            if len(c) == 1:
                cur.execute("UPDATE duels_games SET match_row_id=%s WHERE game_id=%s",
                            (c[0]["id"], g["game_id"]))
                linked += 1
            elif len(c) > 1:
                ambiguous_links.append({"game_id": g["game_id"],
                                        "candidates": [x["id"] for x in c]})
        conn.commit()

    return {"added": added, "updated": updated, "linked": linked,
            "unresolved_card_ids": sorted(unresolved_cards),
            "unmapped_deck_ids": sorted(unmapped_decks),
            "ambiguous_links": ambiguous_links}


def coverage() -> dict:
    """Capture-coverage vs the ledger — the survivorship-bias readout."""
    t = db.query_one(
        """SELECT count(*) FILTER (WHERE result <> 'abandoned') AS games,
                  count(*) FILTER (WHERE result = 'win') AS wins,
                  count(*) FILTER (WHERE result = 'loss') AS losses,
                  count(*) FILTER (WHERE result = 'win' AND match_row_id IS NOT NULL) AS wins_logged,
                  count(*) FILTER (WHERE result = 'loss' AND match_row_id IS NOT NULL) AS losses_logged,
                  count(*) FILTER (WHERE match_row_id IS NOT NULL) AS logged
           FROM duels_games""")
    unlogged = db.query(
        """SELECT played_on_pt, count(*) AS n,
                  count(*) FILTER (WHERE result = 'win') AS w,
                  count(*) FILTER (WHERE result = 'loss') AS l
           FROM duels_games
           WHERE match_row_id IS NULL AND result <> 'abandoned'
           GROUP BY played_on_pt ORDER BY played_on_pt""")
    win_cov = t["wins_logged"] / t["wins"] if t["wins"] else None
    loss_cov = t["losses_logged"] / t["losses"] if t["losses"] else None
    return {**t, "win_coverage": win_cov, "loss_coverage": loss_cov,
            "biased": bool(win_cov and loss_cov is not None
                           and loss_cov < 0.8 * win_cov),
            "unlogged_by_day": unlogged}
