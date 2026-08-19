import csv
import io
import re

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from .. import db
from ..services import deck_import

router = APIRouter()


class DeckCard(BaseModel):
    card_id: str
    qty: int = Field(ge=1)


class DeckIn(BaseModel):
    name: str
    notes: str = ""
    cards: list[DeckCard] = []
    source: str = "api"       # provenance: who wrote this ('mcp', 'webui', 'api')
    format: str | None = None  # 'constructed' | 'sealed'; None = keep/default
    sim_only: bool | None = None  # opponent deck for simulations only


class DeckImportIn(BaseModel):
    name: str
    text: str
    notes: str = ""
    overwrite: bool = False   # replace an existing deck of the same name
    source: str = "api"
    strict: bool = False      # refuse the write if validation warnings exist
    format: str | None = None
    sim_only: bool | None = None


def _check_format(fmt: str | None) -> None:
    if fmt is not None and fmt not in ("constructed", "sealed"):
        raise HTTPException(422, "format must be 'constructed' or 'sealed'")


def _validate(cards: list[dict], fmt: str = "constructed") -> list[str]:
    """Deck-legality warnings. Constructed: 60 cards, max 4 per full name, at
    most 2 inks (a dual-ink card is fine if it shares an ink with the deck's
    two). Sealed/limited: minimum 40 cards — the copy and ink limits do not
    apply (the pool is the limit)."""
    warnings = []
    total = sum(c["qty"] for c in cards)
    if fmt == "sealed":
        if total < 40:
            warnings.append(f"{total} cards — sealed decks are at least 40")
        return warnings
    if total != 60:
        warnings.append(f"{total} cards — constructed decks are exactly 60")
    by_name: dict[str, int] = {}
    for c in cards:
        by_name[c["full_name"]] = by_name.get(c["full_name"], 0) + c["qty"]
    for name, qty in sorted(by_name.items()):
        if qty > 4:
            warnings.append(f"{qty} copies of {name!r} (max 4 per name)")
    mono: set[str] = set()
    duals: list[tuple[str, set[str]]] = []
    for c in cards:
        inks = c.get("inks") or ([c["ink"]] if c.get("ink") else [])
        if len(inks) == 1:
            mono.add(inks[0])
        elif len(inks) > 1:
            duals.append((c["full_name"], set(inks)))
    if len(mono) > 2:
        warnings.append(f"{len(mono)} inks ({', '.join(sorted(mono))}) — decks may use at most 2")
    elif len(mono) == 2:
        for name, dinks in duals:
            if not dinks & mono:
                warnings.append(
                    f"{name!r} ({'/'.join(sorted(dinks))}) shares no ink with the deck's "
                    f"{'/'.join(sorted(mono))}")
    return warnings


def _deck_row(deck_id: int) -> dict:
    deck = db.query_one("SELECT * FROM decks WHERE id=%s", (deck_id,))
    if not deck:
        raise HTTPException(404, "no such deck")
    deck["cards"] = db.query(
        """SELECT dc.card_id, dc.qty, c.full_name, c.ink, c.inks, c.cost, c.rarity, c.type, c.price_usd,
                  c.inkwell, c.legalities, c.strength, c.willpower, c.lore,
                  s.code AS set_code, s.core_legal, c.collector_number, c.image_small,
                  (ec.card_id IS NOT NULL) AS sim_playable,
                  COALESCE(col.qty_normal,0) + COALESCE(col.qty_foil,0) AS owned,
                  COALESCE((SELECT sum(dc2.qty) FROM deck_cards dc2
                            JOIN decks d2 ON d2.id = dc2.deck_id
                            WHERE dc2.card_id = dc.card_id AND d2.in_use
                              AND d2.format = 'constructed'
                              AND d2.id <> dc.deck_id), 0) AS allocated_elsewhere
           FROM deck_cards dc
           JOIN cards c ON c.id = dc.card_id
           JOIN sets s ON s.id = c.set_id
           LEFT JOIN collection col ON col.card_id = dc.card_id
           LEFT JOIN engine_coverage ec ON ec.card_id = dc.card_id
           WHERE dc.deck_id = %s
           ORDER BY c.cost NULLS LAST, c.full_name""",
        (deck_id,),
    )
    for c in deck["cards"]:
        c["free"] = max(0, c["owned"] - c["allocated_elsewhere"])
    if deck["format"] == "sealed":
        deck["pool"] = db.query(
            """SELECT dp.card_id, dp.qty, c.full_name, c.ink, c.inks, c.cost,
                      c.rarity, c.type, s.code AS set_code, c.collector_number
               FROM deck_pool dp
               JOIN cards c ON c.id = dp.card_id
               JOIN sets s ON s.id = c.set_id
               WHERE dp.deck_id = %s
               ORDER BY c.cost NULLS LAST, c.full_name""",
            (deck_id,),
        )
        pool_qty = {p["card_id"]: p["qty"] for p in deck["pool"]}
        for c in deck["cards"]:
            c["in_pool"] = pool_qty.get(c["card_id"], 0)
        deck["pool_total"] = sum(p["qty"] for p in deck["pool"])
    deck["card_total"] = sum(c["qty"] for c in deck["cards"])
    deck["validation"] = _validate(deck["cards"], deck["format"])
    deck["events"] = db.query(
        """SELECT at, action, detail FROM deck_events
           WHERE deck_id=%s ORDER BY at DESC, id DESC LIMIT 8""", (deck_id,))
    return deck


def _write_cards(conn, deck_id: int, cards: list[DeckCard]):
    with conn.cursor() as cur:
        cur.execute("DELETE FROM deck_cards WHERE deck_id=%s", (deck_id,))
        for c in cards:
            cur.execute(
                "INSERT INTO deck_cards (deck_id, card_id, qty) VALUES (%s,%s,%s)",
                (deck_id, c.card_id, c.qty),
            )


@router.get("/decks")
def list_decks():
    return db.query(
        """SELECT d.id, d.name, d.notes, d.in_use, d.format, d.sim_only, d.strategy,
                  d.updated_at, d.wanted,
                  COALESCE(sum(dc.qty), 0) AS card_total,
                  (SELECT array_agg(DISTINCT x.ink ORDER BY x.ink)
                   FROM deck_cards dc2
                   JOIN cards c2 ON c2.id = dc2.card_id,
                        LATERAL unnest(COALESCE(c2.inks, ARRAY[c2.ink])) AS x(ink)
                   WHERE dc2.deck_id = d.id AND x.ink IS NOT NULL) AS inks
           FROM decks d LEFT JOIN deck_cards dc ON dc.deck_id = d.id
           GROUP BY d.id ORDER BY d.in_use DESC, d.name"""
    )


class DeckMetaIn(BaseModel):
    strategy: str | None = None
    notes: str | None = None


@router.patch("/decks/{deck_id}/meta")
def update_deck_meta(deck_id: int, body: DeckMetaIn):
    """Inline edits from the deck list table — strategy/notes only, no card
    changes (PUT /decks/{id} stays the full-update path). Omitted fields keep
    their value; sending an empty string clears the field."""
    if body.strategy is None and body.notes is None:
        raise HTTPException(422, "nothing to update")
    row = db.query_one(
        """UPDATE decks
           SET strategy = CASE WHEN %(s)s::text IS NULL THEN strategy
                               ELSE NULLIF(trim(%(s)s), '') END,
               notes    = CASE WHEN %(n)s::text IS NULL THEN notes
                               ELSE NULLIF(trim(%(n)s), '') END,
               updated_at = now()
           WHERE id = %(id)s RETURNING id, strategy, notes""",
        {"s": body.strategy, "n": body.notes, "id": deck_id},
    )
    if not row:
        raise HTTPException(404, "no such deck")
    return row


@router.post("/decks", status_code=201)
def create_deck(body: DeckIn):
    _check_format(body.format)
    with db.pool.connection() as conn:
        with conn.cursor() as cur:
            try:
                cur.execute(
                    "INSERT INTO decks (name, notes, created_source, format, sim_only)"
                    " VALUES (%s,%s,%s,%s,%s) RETURNING id",
                    (body.name, body.notes, body.source, body.format or "constructed",
                     bool(body.sim_only)),
                )
            except Exception:
                raise HTTPException(409, f"deck {body.name!r} already exists")
            deck_id = cur.fetchone()["id"]
        _write_cards(conn, deck_id, body.cards)
        _log_deck_event(conn, deck_id, "created", f"via {body.source}")
        conn.commit()
    return _deck_row(deck_id)


@router.post("/decks/import", status_code=201)
def import_deck(body: DeckImportIn):
    _check_format(body.format)
    entries, bad_lines = deck_import.parse_deck_text(body.text)
    if not entries:
        raise HTTPException(422, "no parseable deck lines")
    all_unmatched_suffix = [{"qty": None, "name": l, "reason": "unparseable line"} for l in bad_lines]
    with db.pool.connection() as conn:
        with conn.cursor() as cur:
            matched, unmatched = deck_import.match_deck_entries(cur, entries)
            wanted = {c["card_id"]: c["qty"] for c in matched}

            # validate BEFORE writing so strict mode can refuse cleanly
            cur.execute(
                "SELECT id, full_name, ink, inks FROM cards WHERE id = ANY(%s)",
                (list(wanted),),
            )
            card_rows = [{**r, "qty": wanted[r["id"]]} for r in cur.fetchall()]
            warnings = _validate(card_rows, body.format or "constructed")
            if body.strict and warnings:
                raise HTTPException(422, detail={
                    "error": "deck failed validation (strict mode) — nothing written",
                    "validation": warnings,
                    "unmatched": unmatched + all_unmatched_suffix,
                })

            cur.execute("SELECT id, notes FROM decks WHERE name=%s", (body.name,))
            existing = cur.fetchone()
            created = existing is None

            # idempotency: identical card list (+ compatible notes) is a no-op,
            # regardless of the overwrite flag
            if existing:
                cur.execute(
                    "SELECT card_id, qty FROM deck_cards WHERE deck_id=%s", (existing["id"],))
                current = {r["card_id"]: r["qty"] for r in cur.fetchall()}
                notes_same = body.notes in ("", existing["notes"] or "")
                if current == wanted and notes_same:
                    deck = _deck_row(existing["id"])
                    deck["created"] = False
                    deck["unchanged"] = True
                    deck["unmatched"] = unmatched + all_unmatched_suffix
                    return deck

            if existing and not body.overwrite:
                raise HTTPException(
                    409, f"deck {body.name!r} already exists (send overwrite=true to replace)")
            if existing:
                deck_id = existing["id"]
                cur.execute(
                    "UPDATE decks SET notes=%s, updated_at=now(), updated_source=%s,"
                    " format=COALESCE(%s, format), sim_only=COALESCE(%s, sim_only)"
                    " WHERE id=%s",
                    (body.notes, body.source, body.format, body.sim_only, deck_id),
                )
            else:
                cur.execute(
                    "INSERT INTO decks (name, notes, created_source, format, sim_only)"
                    " VALUES (%s,%s,%s,%s,%s) RETURNING id",
                    (body.name, body.notes, body.source, body.format or "constructed",
                     bool(body.sim_only)),
                )
                deck_id = cur.fetchone()["id"]
        _write_cards(conn, deck_id, [DeckCard(**c) for c in matched])
        if created:
            _log_deck_event(conn, deck_id, "created", f"imported via {body.source}")
        conn.commit()
    deck = _deck_row(deck_id)
    deck["created"] = created
    deck["unchanged"] = False
    deck["unmatched"] = unmatched + all_unmatched_suffix
    return deck


@router.get("/decks/{deck_id}")
def get_deck(deck_id: int):
    return _deck_row(deck_id)


@router.put("/decks/{deck_id}")
def update_deck(deck_id: int, body: DeckIn):
    _check_format(body.format)
    if not db.query_one("SELECT 1 FROM decks WHERE id=%s", (deck_id,)):
        raise HTTPException(404, "no such deck")
    with db.pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE decks SET name=%s, notes=%s, updated_at=now(), updated_source=%s,"
                " format=COALESCE(%s, format), sim_only=COALESCE(%s, sim_only) WHERE id=%s",
                (body.name, body.notes, body.source, body.format, body.sim_only, deck_id),
            )
        _write_cards(conn, deck_id, body.cards)
        conn.commit()
    return _deck_row(deck_id)


@router.delete("/decks/{deck_id}", status_code=204)
def delete_deck(deck_id: int):
    if db.execute("DELETE FROM decks WHERE id=%s", (deck_id,)) == 0:
        raise HTTPException(404, "no such deck")


class InUseIn(BaseModel):
    in_use: bool
    force: bool = False           # mark built even when free copies are short
    pull_from_decks: bool = False  # un-build donor decks holding the copies
    source: str = "api"


def _log_deck_event(conn, deck_id: int, action: str, detail: str = "") -> None:
    conn.execute(
        "INSERT INTO deck_events (deck_id, action, detail) VALUES (%s,%s,%s)",
        (deck_id, action, detail or None))


def _donor_decks(deck_id: int, missing: list[dict]) -> list[dict]:
    """Built constructed decks whose sleeves hold copies of this deck's
    missing cards — the candidates to cannibalize."""
    if not missing:
        return []
    return db.query(
        """SELECT d.id, d.name,
                  array_agg(c.full_name || ' x' || dc.qty ORDER BY c.full_name) AS holds
           FROM deck_cards dc
           JOIN decks d ON d.id = dc.deck_id AND d.in_use
             AND d.format = 'constructed' AND d.id <> %s
           JOIN cards c ON c.id = dc.card_id
           WHERE dc.card_id = ANY(%s)
           GROUP BY d.id, d.name ORDER BY d.name""",
        (deck_id, [m["card_id"] for m in missing]))


def _buildable(deck: dict) -> dict:
    """Constructed: validate against FREE copies — owned minus copies allocated
    to OTHER in_use constructed decks ('have' stays raw owned for reference).
    Sealed: validate against the deck's own pool (packs opened), never the
    collection; an empty pool means untracked, not unbuildable.
    Sim-only: ownership is irrelevant — always "buildable" with a note."""
    if deck.get("sim_only"):
        return {
            "deck_id": deck["id"], "name": deck["name"], "in_use": deck["in_use"],
            "format": deck["format"], "sim_only": True,
            "buildable": True, "cards": [], "missing": [], "missing_total": 0,
            "note": "sim-only deck — ownership not checked",
        }
    if deck["format"] == "sealed":
        cards = [
            {
                "card_id": c["card_id"], "full_name": c["full_name"],
                "need": c["qty"], "have": c["in_pool"], "free": c["in_pool"],
                "missing": max(0, c["qty"] - c["in_pool"]),
            }
            for c in deck["cards"]
        ]
        missing = [c for c in cards if c["missing"] > 0]
        if not deck.get("pool"):
            missing = []
        return {
            "deck_id": deck["id"], "name": deck["name"], "in_use": deck["in_use"],
            "format": "sealed", "pool_total": deck.get("pool_total", 0),
            "buildable": not missing, "cards": cards, "missing": missing,
            "missing_total": sum(c["missing"] for c in missing),
            "note": None if deck.get("pool") else
                    "no pool recorded — add the packs you opened to track this",
        }
    cards = [
        {
            "card_id": c["card_id"], "full_name": c["full_name"],
            "need": c["qty"], "have": c["owned"],
            "allocated_elsewhere": c["allocated_elsewhere"], "free": c["free"],
            "missing": max(0, c["qty"] - c["free"]),
            # float, not Decimal: this dict also rides in 409 details, which
            # starlette serializes with plain json.dumps
            "price_usd": float(c["price_usd"]) if c.get("price_usd") is not None else None,
        }
        for c in deck["cards"]
    ]
    missing = [c for c in cards if c["missing"] > 0]
    missing_cost = round(sum(
        float(c["price_usd"]) * c["missing"] for c in missing
        if c["price_usd"] is not None), 2)
    return {
        "deck_id": deck["id"], "name": deck["name"], "in_use": deck["in_use"],
        "format": "constructed",
        "buildable": not missing, "cards": cards, "missing": missing,
        "missing_total": sum(c["missing"] for c in missing),
        "missing_cost": missing_cost,
        "missing_unpriced": sum(1 for c in missing if c["price_usd"] is None),
    }


@router.get("/decks/{deck_id}/buildable")
def buildable(deck_id: int):
    return _buildable(_deck_row(deck_id))


class PoolImportIn(BaseModel):
    text: str
    mode: str = "add"   # add (weekly packs) | replace (full correction)


@router.post("/decks/{deck_id}/pool/import")
def import_pool(deck_id: int, body: PoolImportIn):
    """Add opened cards to a sealed deck's pool from a text list
    ('2 Elsa - Spirit of Winter' per line). mode=add accumulates (league weeks);
    mode=replace rewrites the pool from scratch."""
    if body.mode not in ("add", "replace"):
        raise HTTPException(422, "mode must be 'add' or 'replace'")
    deck = db.query_one("SELECT id, format FROM decks WHERE id=%s", (deck_id,))
    if not deck:
        raise HTTPException(404, "no such deck")
    if deck["format"] != "sealed":
        raise HTTPException(422, "pool tracking is for sealed decks only")
    entries, bad_lines = deck_import.parse_deck_text(body.text)
    if not entries:
        raise HTTPException(422, "no parseable card lines")
    with db.pool.connection() as conn:
        with conn.cursor() as cur:
            matched, unmatched = deck_import.match_deck_entries(cur, entries)
            if body.mode == "replace":
                cur.execute("DELETE FROM deck_pool WHERE deck_id=%s", (deck_id,))
            for c in matched:
                cur.execute(
                    """INSERT INTO deck_pool (deck_id, card_id, qty) VALUES (%s,%s,%s)
                       ON CONFLICT (deck_id, card_id)
                       DO UPDATE SET qty = deck_pool.qty + EXCLUDED.qty""",
                    (deck_id, c["card_id"], c["qty"]),
                )
        conn.commit()
    result = _deck_row(deck_id)
    result["unmatched"] = unmatched + [
        {"qty": None, "name": l, "reason": "unparseable line"} for l in bad_lines]
    return result


@router.delete("/decks/{deck_id}/pool/{card_id}", status_code=204)
def remove_pool_card(deck_id: int, card_id: str):
    if db.execute("DELETE FROM deck_pool WHERE deck_id=%s AND card_id=%s",
                  (deck_id, card_id)) == 0:
        raise HTTPException(404, "card not in pool")


@router.get("/decks/{deck_id}/export")
def export_deck(deck_id: int):
    """Tournament export: Dreamborn-compatible text list + composition analysis
    (type counts, cost curve, inkable split, per-ink counts, Core legality)."""
    deck = _deck_row(deck_id)
    cards = sorted(deck["cards"], key=lambda c: (c["cost"] or 0, c["full_name"]))

    text = "\n".join(f"{c['qty']} {c['full_name']}" for c in cards)

    def primary_type(c) -> str:
        t = c.get("type") or []
        if "Song" in t:
            return "Action — Song"
        for k in ("Character", "Action", "Item", "Location"):
            if k in t:
                return k
        return "Other"

    type_counts: dict[str, int] = {}
    curve: dict[str, int] = {}
    ink_counts: dict[str, int] = {}
    inkable = 0
    lore_total = 0
    cost_qty_sum = 0
    for c in cards:
        type_counts[primary_type(c)] = type_counts.get(primary_type(c), 0) + c["qty"]
        bucket = "9+" if (c["cost"] or 0) >= 9 else str(c["cost"] or 0)
        curve[bucket] = curve.get(bucket, 0) + c["qty"]
        # One bucket per ink COMBO (dual-ink cards get their own "A/B" bucket)
        # so the counts sum to the deck total instead of double-counting duals.
        combo = "/".join(c.get("inks") or ([c["ink"]] if c.get("ink") else []))
        if combo:
            ink_counts[combo] = ink_counts.get(combo, 0) + c["qty"]
        if c.get("inkwell"):
            inkable += c["qty"]
        if c.get("lore"):
            lore_total += c["lore"] * c["qty"]
        cost_qty_sum += (c["cost"] or 0) * c["qty"]

    total = deck["card_total"]
    # Core legality = sets.core_legal (maintained via migration 009); Lorcast's
    # legalities field proved stale on rotation and new-set dates. Sealed decks
    # play whatever the packs contained — set legality does not apply.
    not_core_legal = [] if deck["format"] == "sealed" else [
        {"full_name": c["full_name"], "qty": c["qty"], "set_code": c["set_code"],
         "status": f"set {c['set_code']} rotated out / not Core-legal",
         "lorcast_says": (c.get("legalities") or {}).get("core", "unknown")}
        for c in cards
        if not c.get("core_legal")
    ]

    return {
        "deck_id": deck["id"], "name": deck["name"], "notes": deck["notes"],
        "in_use": deck["in_use"], "format": deck["format"], "card_total": total,
        "text": text,
        "cards": [
            {k: c[k] for k in ("qty", "full_name", "set_code", "collector_number",
                               "ink", "inks", "cost", "inkwell", "rarity", "type")}
            for c in cards
        ],
        "composition": {
            "type_counts": type_counts,
            "cost_curve": {k: curve[k] for k in sorted(curve, key=lambda x: 99 if x == "9+" else int(x))},
            "ink_counts": ink_counts,
            "inkable": inkable,
            "uninkable": total - inkable,
            "avg_cost": round(cost_qty_sum / total, 2) if total else 0,
            "total_lore": lore_total,
        },
        "validation": deck["validation"],
        "not_core_legal": not_core_legal,
        "core_legal": not not_core_legal and not deck["validation"],
    }


@router.get("/decks/{deck_id}/export.csv")
def export_deck_csv(deck_id: int):
    """Dreamborn.ink-compatible CSV (the variant-row schema Dreamborn itself
    exports: Set Number, Card Number, Variant, Count, Name, Color, Rarity), so
    the file imports straight back into Dreamborn — and into our own Upload
    page. Decks don't track foils, so every row is Variant=normal."""
    deck = _deck_row(deck_id)
    cards = sorted(deck["cards"], key=lambda c: (c["cost"] or 0, c["full_name"]))
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Set Number", "Card Number", "Variant", "Count", "Name", "Color", "Rarity"])
    for c in cards:
        color = "/".join(c.get("inks") or ([c["ink"]] if c.get("ink") else []))
        w.writerow([c["set_code"], c["collector_number"], "normal", c["qty"],
                    c["full_name"], color, c.get("rarity") or ""])
    slug = re.sub(r"[^a-z0-9]+", "-", deck["name"].lower()).strip("-") or "deck"
    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{slug}.csv"'},
    )


class WantedIn(BaseModel):
    wanted: bool


@router.put("/decks/{deck_id}/wanted")
def set_wanted(deck_id: int, body: WantedIn):
    if body.wanted and db.query_one(
            "SELECT 1 FROM decks WHERE id=%s AND sim_only", (deck_id,)):
        raise HTTPException(422, "sim-only decks can't join the want list")
    if db.execute("UPDATE decks SET wanted=%s, updated_at=now() WHERE id=%s",
                  (body.wanted, deck_id)) == 0:
        raise HTTPException(404, "no such deck")
    return _deck_row(deck_id)


@router.get("/wantlist")
def wantlist():
    """Shopping list: missing copies aggregated across WANTED constructed decks
    (not yet built), needed on top of copies already allocated to built decks.
    Assumes you want every flagged deck buildable simultaneously."""
    skips = {r["card_id"] for r in db.query("SELECT card_id FROM wantlist_skips")}
    rows = db.query(
        """SELECT c.id AS card_id, c.full_name, s.code AS set_code,
                  c.collector_number, c.rarity, c.price_usd,
                  sum(dc.qty) AS qty_wanted,
                  array_agg(DISTINCT d.name ORDER BY d.name) AS decks,
                  COALESCE(col.qty_normal,0) + COALESCE(col.qty_foil,0) AS owned,
                  COALESCE((SELECT sum(dc2.qty) FROM deck_cards dc2
                            JOIN decks d2 ON d2.id = dc2.deck_id
                            WHERE dc2.card_id = c.id AND d2.in_use
                              AND d2.format = 'constructed'), 0) AS allocated
           FROM deck_cards dc
           JOIN decks d ON d.id = dc.deck_id
             AND d.wanted AND NOT d.in_use AND NOT d.sim_only AND d.format = 'constructed'
           JOIN cards c ON c.id = dc.card_id
           JOIN sets s ON s.id = c.set_id
           LEFT JOIN collection col ON col.card_id = c.id
           GROUP BY c.id, c.full_name, s.code, c.collector_number, c.rarity,
                    c.price_usd, col.qty_normal, col.qty_foil""")
    cards, skipped = [], []
    for r in rows:
        need = max(0, r["qty_wanted"] + r["allocated"] - r["owned"])
        if not need:
            continue
        if r["card_id"] in skips:
            skipped.append({"card_id": r["card_id"], "full_name": r["full_name"],
                            "set_code": r["set_code"],
                            "collector_number": r["collector_number"], "need": need})
            continue
        price = float(r["price_usd"]) if r["price_usd"] is not None else None
        cards.append({**r, "need": need,
                      "line_cost": round(price * need, 2) if price is not None else None})
    cards.sort(key=lambda c: (-(c["line_cost"] or 0), c["full_name"]))
    wanted_decks = db.query(
        """SELECT id, name FROM decks
           WHERE wanted AND NOT in_use AND NOT sim_only AND format='constructed' ORDER BY name""")
    return {
        "wanted_decks": wanted_decks,
        "cards": cards,
        "total_cost": round(sum(c["line_cost"] or 0 for c in cards), 2),
        "unpriced": sum(1 for c in cards if c["line_cost"] is None),
        "skipped": skipped,
        "text": "\n".join(
            f"{c['need']} {c['full_name']} [{c['set_code']}/{c['collector_number']}]"
            + (f" — ${c['line_cost']}" if c["line_cost"] is not None else "")
            for c in cards),
        "tcg_text": _tcg_text(cards),
    }


# --- TCGplayer mass-entry export -------------------------------------------

def _tcg_denoms() -> dict:
    """Printed card-code denominator per set = highest collector number among
    standard rarities (Enchanted/Epic/Iconic live above it — e.g. set 13 is
    N/207 on the card while the catalog holds 245 printings)."""
    return {r["set_id"]: r["denom"] for r in db.query(
        """SELECT set_id,
                  max(NULLIF(regexp_replace(collector_number,'\\D','','g'),'')::int)
                    FILTER (WHERE rarity NOT IN ('Enchanted','Epic','Iconic')) AS denom
           FROM cards GROUP BY set_id""")}


def _tcg_text(cards: list[dict]) -> str:
    """TCGplayer Mass Entry lines using the printed card code — the same
    dreamborn.ink-style '(17/207)' identity TCGplayer product names carry,
    which matches uniquely where bare names mis-parse."""
    denoms = _tcg_denoms()
    lines = []
    for c in cards:
        qty = c.get("need") or c.get("qty") or 1
        num = c["collector_number"]
        denom = denoms.get(c.get("set_id") or "")
        if denom is None:
            row = db.query_one(
                "SELECT set_id FROM cards WHERE id=%s", (c["card_id"],))
            denom = denoms.get(row["set_id"]) if row else None
        code = f" ({num}/{denom})" if denom and num.isdigit() else ""
        lines.append(f"{qty} {c['full_name']}{code}")
    return "\n".join(lines)


class SkipIn(BaseModel):
    card_id: str


@router.post("/wantlist/skips", status_code=201)
def add_wantlist_skip(body: SkipIn):
    """Remove one card from the aggregated want list ("bought it / don't want
    it") without touching any deck's wanted flag. Restorable."""
    if not db.query_one("SELECT 1 FROM cards WHERE id=%s", (body.card_id,)):
        raise HTTPException(404, "unknown card")
    db.execute("""INSERT INTO wantlist_skips (card_id) VALUES (%s)
                  ON CONFLICT (card_id) DO NOTHING""", (body.card_id,))
    return {"card_id": body.card_id, "skipped": True}


@router.delete("/wantlist/skips/{card_id}", status_code=204)
def remove_wantlist_skip(card_id: str):
    if db.execute("DELETE FROM wantlist_skips WHERE card_id=%s", (card_id,)) == 0:
        raise HTTPException(404, "card not skipped")


@router.post("/wantlist/clear")
def clear_wantlist():
    """Empty the deck-derived want list by unflagging every wanted deck (the
    decks themselves are untouched). Skips are kept — they record cards you
    decided against, independent of which decks are flagged."""
    n = db.execute("UPDATE decks SET wanted=false, updated_at=now() WHERE wanted")
    return {"decks_unflagged": n}


# --- named want lists --------------------------------------------------------

class WantListIn(BaseModel):
    name: str
    deck_id: int | None = None


class WantListCardIn(BaseModel):
    card_id: str = ""
    card: str = ""                     # name lookup alternative to card_id
    qty: int = 1                       # 0 removes


def _wantlist_items(wl: dict) -> list[dict]:
    """Manual entries plus, for a deck-linked list, the deck's live shortfall
    (computed at read time, so the list tracks collection changes)."""
    items = db.query(
        """SELECT wc.card_id, wc.qty, c.full_name, s.code AS set_code, c.set_id,
                  c.collector_number, c.rarity, c.price_usd, 'manual' AS source
           FROM want_list_cards wc
           JOIN cards c ON c.id = wc.card_id JOIN sets s ON s.id = c.set_id
           WHERE wc.list_id = %s""", (wl["id"],))
    if wl.get("deck_id"):
        manual_ids = {i["card_id"] for i in items}
        for r in db.query(
                """SELECT c.id AS card_id, c.full_name, s.code AS set_code, c.set_id,
                          c.collector_number, c.rarity, c.price_usd, dc.qty AS qty_wanted,
                          COALESCE(col.qty_normal,0) + COALESCE(col.qty_foil,0) AS owned,
                          COALESCE((SELECT sum(dc2.qty) FROM deck_cards dc2
                                    JOIN decks d2 ON d2.id = dc2.deck_id
                                    WHERE dc2.card_id = c.id AND d2.in_use
                                      AND d2.format = 'constructed'
                                      AND d2.id <> %s), 0) AS allocated
                   FROM deck_cards dc
                   JOIN cards c ON c.id = dc.card_id
                   JOIN sets s ON s.id = c.set_id
                   LEFT JOIN collection col ON col.card_id = c.id
                   WHERE dc.deck_id = %s""", (wl["deck_id"], wl["deck_id"])):
            need = max(0, r["qty_wanted"] + r["allocated"] - r["owned"])
            if need and r["card_id"] not in manual_ids:
                items.append({"card_id": r["card_id"], "qty": need,
                              "full_name": r["full_name"], "set_code": r["set_code"],
                              "set_id": r["set_id"],
                              "collector_number": r["collector_number"],
                              "rarity": r["rarity"], "price_usd": r["price_usd"],
                              "source": "deck"})
    for i in items:
        p = float(i["price_usd"]) if i["price_usd"] is not None else None
        i["line_cost"] = round(p * i["qty"], 2) if p is not None else None
    items.sort(key=lambda i: (-(i["line_cost"] or 0), i["full_name"]))
    return items


@router.get("/wantlists")
def list_want_lists():
    lists = db.query(
        """SELECT wl.id, wl.name, wl.deck_id, d.name AS deck_name, wl.created_at
           FROM want_lists wl LEFT JOIN decks d ON d.id = wl.deck_id
           ORDER BY wl.name""")
    for wl in lists:
        items = _wantlist_items(wl)
        wl["cards"] = items
        wl["total_cost"] = round(sum(i["line_cost"] or 0 for i in items), 2)
        wl["unpriced"] = sum(1 for i in items if i["line_cost"] is None)
        wl["text"] = "\n".join(
            f"{i['qty']} {i['full_name']} [{i['set_code']}/{i['collector_number']}]"
            for i in items)
        wl["tcg_text"] = _tcg_text(items)
    return lists


@router.post("/wantlists", status_code=201)
def create_want_list(body: WantListIn):
    if body.deck_id is not None and not db.query_one(
            "SELECT 1 FROM decks WHERE id=%s", (body.deck_id,)):
        raise HTTPException(404, f"no deck #{body.deck_id}")
    try:
        row = db.query_one(
            "INSERT INTO want_lists (name, deck_id) VALUES (%s,%s) RETURNING id, name",
            (body.name.strip(), body.deck_id))
    except Exception:
        raise HTTPException(409, f"want list {body.name!r} already exists")
    return row


@router.delete("/wantlists/{list_id}", status_code=204)
def delete_want_list(list_id: int):
    if db.execute("DELETE FROM want_lists WHERE id=%s", (list_id,)) == 0:
        raise HTTPException(404, "no such want list")


@router.put("/wantlists/{list_id}/cards")
def set_want_list_card(list_id: int, body: WantListCardIn):
    """Upsert one card on a named list (qty=0 removes). `card` accepts a name
    when card_id isn't known — exact full-name/name match, else 422 with
    candidates."""
    if not db.query_one("SELECT 1 FROM want_lists WHERE id=%s", (list_id,)):
        raise HTTPException(404, "no such want list")
    card_id = body.card_id
    if not card_id:
        if not body.card.strip():
            raise HTTPException(422, "provide card_id or card")
        hits = db.query(
            """SELECT c.id, c.full_name, s.code AS set_code, c.collector_number
               FROM cards c JOIN sets s ON s.id = c.set_id
               WHERE lower(c.full_name) = lower(%s) OR lower(c.name) = lower(%s)
               ORDER BY (c.rarity IN ('Enchanted','Epic','Iconic')),
                        s.released_at DESC NULLS LAST""",
            (body.card.strip(), body.card.strip()))
        if not hits:
            raise HTTPException(422, f"no card named {body.card!r}")
        card_id = hits[0]["id"]
    if body.qty <= 0:
        if db.execute("DELETE FROM want_list_cards WHERE list_id=%s AND card_id=%s",
                      (list_id, card_id)) == 0:
            raise HTTPException(404, "card not on this list")
        return {"list_id": list_id, "card_id": card_id, "qty": 0}
    db.execute(
        """INSERT INTO want_list_cards (list_id, card_id, qty) VALUES (%s,%s,%s)
           ON CONFLICT (list_id, card_id) DO UPDATE SET qty = EXCLUDED.qty""",
        (list_id, card_id, body.qty))
    return {"list_id": list_id, "card_id": card_id, "qty": body.qty}


@router.put("/decks/{deck_id}/in_use")
def set_in_use(deck_id: int, body: InUseIn):
    deck = _deck_row(deck_id)
    if deck.get("sim_only") and body.in_use:
        raise HTTPException(422, "sim-only decks can't be marked built — they aren't owned")
    donors_pulled: list[dict] = []
    if body.in_use and not deck["in_use"] and not body.force:
        b = _buildable(deck)
        if b["missing"]:
            sealed = deck["format"] == "sealed"
            donors = [] if sealed else _donor_decks(deck_id, b["missing"])
            # Would un-building every donor cover the shortfall?
            after_pull_missing = b["missing"]
            if donors:
                rem = {r["card_id"]: r["q"] for r in db.query(
                    """SELECT dc.card_id, COALESCE(sum(dc.qty), 0) AS q
                       FROM deck_cards dc
                       JOIN decks d ON d.id = dc.deck_id AND d.in_use
                         AND d.format = 'constructed' AND d.id <> %s
                         AND NOT (d.id = ANY(%s))
                       WHERE dc.card_id = ANY(%s) GROUP BY dc.card_id""",
                    (deck_id, [d["id"] for d in donors],
                     [m["card_id"] for m in b["missing"]]))}
                after_pull_missing = [m for m in (
                    {**m, "missing": max(0, m["need"] - max(0, m["have"] - rem.get(m["card_id"], 0)))}
                    for m in b["missing"]) if m["missing"] > 0]
            if body.pull_from_decks and donors and not after_pull_missing:
                # Cannibalize: donors stop being built (their recipes stay
                # intact); their copies become free for this deck.
                with db.pool.connection() as conn:
                    for d in donors:
                        conn.execute(
                            "UPDATE decks SET in_use=false, updated_at=now() WHERE id=%s",
                            (d["id"],))
                        _log_deck_event(conn, d["id"], "unbuilt",
                                        f"copies pulled for {deck['name']!r} (#{deck_id}) "
                                        f"via {body.source}")
                    conn.commit()
                donors_pulled = donors
            else:
                raise HTTPException(409, detail={
                    "error": ("deck uses cards that aren't in its sealed pool" if sealed
                              else "not enough free copies to build this deck"),
                    "missing": b["missing"],
                    "donors": donors,
                    "after_pull_missing": after_pull_missing,
                    "hint": ("add the missing pulls to the pool or fix the deck; "
                             "send force=true to mark it built anyway" if sealed else
                             "send pull_from_decks=true to un-build the donor decks and "
                             "pull their copies, or force=true to mark built anyway"),
                })
    changed = deck["in_use"] != body.in_use
    with db.pool.connection() as conn:
        conn.execute("UPDATE decks SET in_use=%s, updated_at=now() WHERE id=%s",
                     (body.in_use, deck_id))
        if changed:
            detail = ""
            if donors_pulled:
                detail = "pulled copies from: " + ", ".join(d["name"] for d in donors_pulled) + " · "
            elif body.force and body.in_use:
                detail = "forced despite shortfall · "
            _log_deck_event(conn, deck_id, "built" if body.in_use else "unbuilt",
                            f"{detail}via {body.source}")
        conn.commit()
    result = _deck_row(deck_id)
    result["pulled_from"] = [d["name"] for d in donors_pulled]
    return result


class CloneIn(BaseModel):
    name: str
    source: str = "api"


@router.post("/decks/{deck_id}/clone", status_code=201)
def clone_deck(deck_id: int, body: CloneIn):
    """Duplicate a deck's list/notes/format as a new unbuilt deck — the
    rebuild-as-new-version workflow. The original's recipe stays intact."""
    src = db.query_one("SELECT * FROM decks WHERE id=%s", (deck_id,))
    if not src:
        raise HTTPException(404, "no such deck")
    with db.pool.connection() as conn:
        with conn.cursor() as cur:
            try:
                cur.execute(
                    "INSERT INTO decks (name, notes, created_source, format, sim_only)"
                    " VALUES (%s,%s,%s,%s,%s) RETURNING id",
                    (body.name, src["notes"], body.source, src["format"], src["sim_only"]))
            except Exception:
                raise HTTPException(409, f"deck {body.name!r} already exists")
            new_id = cur.fetchone()["id"]
            cur.execute(
                """INSERT INTO deck_cards (deck_id, card_id, qty)
                   SELECT %s, card_id, qty FROM deck_cards WHERE deck_id=%s""",
                (new_id, deck_id))
        _log_deck_event(conn, new_id, "cloned",
                        f"from {src['name']!r} (#{deck_id}) via {body.source}")
        conn.commit()
    return _deck_row(new_id)


@router.get("/allocation-conflicts")
def allocation_conflicts():
    """Cards claimed by built constructed decks beyond owned copies — the DB is
    lying about physical reality (usually after a force-build). Empty = clean."""
    return db.query(
        """SELECT c.id AS card_id, c.full_name, s.code AS set_code, c.collector_number,
                  COALESCE(col.qty_normal + col.qty_foil, 0) AS owned,
                  sum(dc.qty) AS claimed,
                  array_agg(d.name || ' x' || dc.qty ORDER BY d.name) AS decks
           FROM deck_cards dc
           JOIN decks d ON d.id = dc.deck_id AND d.in_use AND d.format = 'constructed'
           JOIN cards c ON c.id = dc.card_id
           JOIN sets s ON s.id = c.set_id
           LEFT JOIN collection col ON col.card_id = c.id
           GROUP BY c.id, c.full_name, s.code, c.collector_number, col.qty_normal, col.qty_foil
           HAVING sum(dc.qty) > COALESCE(col.qty_normal + col.qty_foil, 0)
           ORDER BY c.full_name""")
