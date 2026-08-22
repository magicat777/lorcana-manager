"""Collection snapshots: one row = the whole collection at a moment in time,
with per-dimension breakdowns baked into JSONB so charts never need to
reconstruct history from mutable tables.

Captured daily by the snapshot CronJob and after every real (non-dry-run)
import, so upload-driven jumps land on the exact timestamp they happened."""
from psycopg.types.json import Jsonb

# Dual-ink cards bucket as their combo ("Amber/Ruby"), matching the deck
# composition convention — per-ink counting would double-count copies.
_ROWS_SQL = """
    SELECT c.rarity, c.ink, c.inks, c.cost, c.type[1] AS ctype, s.code AS set_code,
           col.qty_normal + col.qty_foil AS copies,
           col.qty_foil AS foil,
           (col.qty_normal * COALESCE(c.price_usd, 0)
            + col.qty_foil * COALESCE(c.price_usd_foil, 0)) AS value
    FROM collection col
    JOIN cards c ON c.id = col.card_id
    JOIN sets s ON s.id = c.set_id
    WHERE col.qty_normal + col.qty_foil > 0
"""


def _bump(dim: dict, bucket: str, copies: int, value: float) -> None:
    b = dim.setdefault(bucket, {"c": 0, "u": 0, "v": 0.0})
    b["c"] += copies
    b["u"] += 1
    b["v"] = round(b["v"] + value, 2)


def build(cur) -> dict:
    """Compute totals + breakdowns from the live collection (no writes)."""
    cur.execute(_ROWS_SQL)
    breakdown: dict[str, dict] = {"rarity": {}, "ink": {}, "set": {}, "type": {}, "cost": {}}
    total = unique = foil = 0
    value = 0.0
    for r in cur.fetchall():
        copies, val = r["copies"], float(r["value"])
        total += copies
        unique += 1
        foil += r["foil"]
        value += val
        ink = "/".join(r["inks"] or ([r["ink"]] if r["ink"] else ["None"]))
        _bump(breakdown["rarity"], r["rarity"] or "Unknown", copies, val)
        _bump(breakdown["ink"], ink, copies, val)
        _bump(breakdown["set"], r["set_code"], copies, val)
        _bump(breakdown["type"], r["ctype"] or "Unknown", copies, val)
        _bump(breakdown["cost"], str(r["cost"]) if r["cost"] is not None else "?", copies, val)
    return {"total_cards": total, "unique_cards": unique, "total_foil": foil,
            "value_usd": round(value, 2), "breakdown": breakdown}


def capture(cur, source: str, import_id: int | None = None) -> int:
    snap = build(cur)
    cur.execute(
        """INSERT INTO collection_snapshots
             (source, import_id, total_cards, unique_cards, total_foil, value_usd, breakdown)
           VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
        (source, import_id, snap["total_cards"], snap["unique_cards"],
         snap["total_foil"], snap["value_usd"], Jsonb(snap["breakdown"])),
    )
    return cur.fetchone()["id"]
