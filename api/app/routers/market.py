"""Sealed-product price log. Sealed prices have no scrapeable source (Lorcast
prices singles only), so observations are entered by hand — from the webui-side
this is read-only; logging happens through the MCP tool or a direct POST. The
daily brief turns these into Sealed Premium vs Competitive Index signals."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import db

router = APIRouter(tags=["market"])


class SealedProductIn(BaseModel):
    name: str = Field(min_length=3)
    set_code: str | None = None
    kind: str = "other"
    msrp: float = Field(gt=0)


class SealedObsIn(BaseModel):
    price: float = Field(gt=0)
    source: str | None = None


@router.get("/market/sealed")
def sealed_products():
    return db.query(
        """SELECT p.id, p.name, p.set_code, p.kind, p.msrp, p.active,
                  o.price AS last_price, o.source AS last_source,
                  o.observed_at AS last_observed_at,
                  CASE WHEN o.price IS NOT NULL
                       THEN round(o.price / p.msrp, 2) END AS sealed_premium,
                  (SELECT count(*) FROM sealed_price_obs
                    WHERE product_id = p.id) AS observations
           FROM sealed_products p
           LEFT JOIN LATERAL (
             SELECT price, source, observed_at FROM sealed_price_obs
             WHERE product_id = p.id ORDER BY observed_at DESC LIMIT 1) o ON true
           ORDER BY p.set_code DESC NULLS LAST, p.name""")


def _price_as_of():
    r = db.query_one("SELECT max(captured_at) AS m FROM price_history")
    return r["m"] if r else None


@router.get("/market/holdings")
def top_holdings(limit: int = 20):
    """Owned cards by holding value with per-finish day deltas (dollar AND
    unit-percent — a $1.62 move on a $3.51 card and a $0.17 move on a $99
    card aren't comparable in dollars), foil premium ratio (≈1.0 priced on
    play demand, 2.0+ collector-driven), and the 30-day liquidity proxy
    (nights the finish's market price moved — TCGplayer's market price only
    ticks on sales, so ~15+ = actively traded, single digits =
    illiquid/stale). `as_of` stamps the snapshot the prices come from.
    Mirrors the Grafana Top-20 panel."""
    limit = max(1, min(limit, 100))
    rows = db.query(
        """WITH ph AS (SELECT card_id, captured_at,
                              CASE WHEN NOT suspect_normal THEN usd END AS usd,
                              CASE WHEN NOT suspect_foil THEN usd_foil END AS usd_foil
                       FROM price_history),
           moves AS (
             SELECT card_id,
                    count(*) FILTER (WHERE usd IS DISTINCT FROM p_usd) AS mv_n,
                    count(*) FILTER (WHERE usd_foil IS DISTINCT FROM p_usd_foil) AS mv_f,
                    avg(usd) AS a_n, avg(usd_foil) AS a_f
             FROM (SELECT card_id, usd, usd_foil,
                          lag(usd) OVER w AS p_usd, lag(usd_foil) OVER w AS p_usd_foil,
                          row_number() OVER w AS rn
                   FROM ph
                   WHERE captured_at > now() - interval '30 days'
                   WINDOW w AS (PARTITION BY card_id ORDER BY captured_at)) x
             WHERE rn > 1 GROUP BY card_id),
           latest AS (SELECT DISTINCT ON (card_id) card_id, usd, usd_foil
                      FROM ph ORDER BY card_id, captured_at DESC),
           prev AS (SELECT DISTINCT ON (card_id) card_id, usd, usd_foil
                    FROM ph
                    WHERE captured_at < date_trunc('day',
                      (SELECT max(captured_at) FROM price_history))
                    ORDER BY card_id, captured_at DESC)
           SELECT c.full_name, s.code AS set_code, c.collector_number, c.rarity,
                  col.qty_normal, col.qty_foil, c.price_usd, c.price_usd_foil,
                  -- per-price COALESCE inside the product (NULL-price row-drop trap)
                  (col.qty_normal * COALESCE(c.price_usd, 0)
                   + col.qty_foil * COALESCE(c.price_usd_foil, 0))::numeric(12,2) AS value,
                  CASE WHEN p.card_id IS NULL THEN NULL ELSE
                    (col.qty_normal * (COALESCE(l.usd,0) - COALESCE(p.usd,0)))::numeric(12,2)
                  END AS delta_normal,
                  CASE WHEN p.card_id IS NULL THEN NULL ELSE
                    (col.qty_foil * (COALESCE(l.usd_foil,0) - COALESCE(p.usd_foil,0)))::numeric(12,2)
                  END AS delta_foil,
                  CASE WHEN p.usd > 0 AND l.usd IS NOT NULL THEN
                    round(100 * (l.usd - p.usd) / p.usd, 1) END AS pct_normal,
                  CASE WHEN p.usd_foil > 0 AND l.usd_foil IS NOT NULL THEN
                    round(100 * (l.usd_foil - p.usd_foil) / p.usd_foil, 1) END AS pct_foil,
                  CASE WHEN COALESCE(c.price_usd, 0) > 0 AND c.price_usd_foil IS NOT NULL THEN
                    round(c.price_usd_foil / c.price_usd, 2) END AS foil_ratio,
                  CASE WHEN m.a_n > 0 AND l.usd IS NOT NULL THEN
                    round(l.usd / m.a_n, 2) END AS ci_normal,
                  CASE WHEN m.a_f > 0 AND l.usd_foil IS NOT NULL THEN
                    round(l.usd_foil / m.a_f, 2) END AS ci_foil,
                  COALESCE(m.mv_n, 0) AS moves_normal_30d,
                  COALESCE(m.mv_f, 0) AS moves_foil_30d
           FROM collection col
           JOIN cards c ON c.id = col.card_id
           JOIN sets s ON s.id = c.set_id
           LEFT JOIN latest l ON l.card_id = c.id
           LEFT JOIN prev p ON p.card_id = c.id
           LEFT JOIN moves m ON m.card_id = c.id
           WHERE col.qty_normal + col.qty_foil > 0
           ORDER BY value DESC LIMIT %s""",
        (limit,))
    return {"as_of": _price_as_of(), "rows": rows}


@router.get("/market/movers")
def movers(days: int = 7, min_price: float = 1.0, limit: int = 20,
           owned: bool = False, set_code: str = "", finish: str = "",
           rarity: str = "", core_legal: bool = False):
    """Biggest percent price moves per (card, finish) over the window, with a
    price floor so ten-cent swings on bulk commons don't dominate. Filters:
    `set_code`, `finish` (normal|foil), `rarity`, `core_legal=true`,
    `owned=true`. Suspect ticks (outlier guard) are excluded. Each row
    carries `ci` (now ÷ trailing 30-day avg). `then_price` is the newest
    clean snapshot at least `days` old. Stamped with the snapshot `as_of`."""
    days = max(1, min(days, 90))
    limit = max(1, min(limit, 100))
    rows = db.query(
        """WITH ph AS (SELECT card_id, captured_at,
                              CASE WHEN NOT suspect_normal THEN usd END AS usd,
                              CASE WHEN NOT suspect_foil THEN usd_foil END AS usd_foil
                       FROM price_history),
           latest AS (SELECT DISTINCT ON (card_id) card_id, usd, usd_foil
                      FROM ph ORDER BY card_id, captured_at DESC),
           thn AS (SELECT DISTINCT ON (card_id) card_id, usd, usd_foil
                   FROM ph
                   WHERE captured_at <= now() - make_interval(days => %(days)s)
                   ORDER BY card_id, captured_at DESC),
           avg30 AS (SELECT card_id, avg(usd) AS a_n, avg(usd_foil) AS a_f,
                            count(usd) AS n_n, count(usd_foil) AS n_f
                     FROM ph WHERE captured_at > now() - interval '30 days'
                     GROUP BY card_id),
           finishes AS (
             SELECT l.card_id, 'normal' AS finish, t.usd AS then_price,
                    l.usd AS now_price, a.a_n AS avg30, a.n_n AS n_obs_30d
             FROM latest l JOIN thn t USING (card_id) LEFT JOIN avg30 a USING (card_id)
             UNION ALL
             SELECT l.card_id, 'foil', t.usd_foil, l.usd_foil, a.a_f, a.n_f
             FROM latest l JOIN thn t USING (card_id) LEFT JOIN avg30 a USING (card_id))
           SELECT c.full_name, s.code AS set_code, c.collector_number, c.rarity,
                  f.finish, f.then_price, f.now_price,
                  round(100 * (f.now_price - f.then_price) / f.then_price, 1) AS pct,
                  CASE WHEN f.avg30 > 0 THEN round(f.now_price / f.avg30, 2) END AS ci,
                  COALESCE(f.n_obs_30d, 0) AS n_obs_30d,
                  COALESCE(col.qty_normal, 0) AS qty_normal,
                  COALESCE(col.qty_foil, 0) AS qty_foil
           FROM finishes f
           JOIN cards c ON c.id = f.card_id
           JOIN sets s ON s.id = c.set_id
           LEFT JOIN collection col ON col.card_id = c.id
           WHERE f.then_price >= %(min_price)s AND f.now_price IS NOT NULL
             AND (%(set_code)s = '' OR s.code = %(set_code)s)
             AND (%(finish)s = '' OR f.finish = %(finish)s)
             AND (%(rarity)s = '' OR c.rarity ILIKE %(rarity)s)
             AND (NOT %(core)s OR s.core_legal)
             AND (NOT %(owned)s
                  OR COALESCE(col.qty_normal, 0) + COALESCE(col.qty_foil, 0) > 0)
           ORDER BY abs(100 * (f.now_price - f.then_price) / f.then_price) DESC
           LIMIT %(limit)s""",
        {"days": days, "min_price": min_price, "limit": limit, "owned": owned,
         "set_code": set_code, "finish": finish, "rarity": rarity,
         "core": core_legal})
    return {"as_of": _price_as_of(), "days": days, "min_price": min_price,
            "rows": rows}


@router.post("/market/sealed", status_code=201)
def add_sealed_product(body: SealedProductIn):
    row = db.query_one(
        """INSERT INTO sealed_products (name, set_code, kind, msrp)
           VALUES (%s, %s, %s, %s)
           ON CONFLICT (name) DO UPDATE SET msrp = EXCLUDED.msrp, active = true
           RETURNING id, name, set_code, kind, msrp""",
        (body.name.strip(), body.set_code, body.kind, body.msrp))
    return row


@router.post("/market/sealed/{product_id}/obs", status_code=201)
def log_sealed_price(product_id: int, body: SealedObsIn):
    prod = db.query_one("SELECT id, name, msrp FROM sealed_products WHERE id=%s",
                        (product_id,))
    if not prod:
        raise HTTPException(404, "no such sealed product")
    db.execute(
        "INSERT INTO sealed_price_obs (product_id, price, source) VALUES (%s, %s, %s)",
        (product_id, body.price, body.source))
    return {"product": prod["name"], "price": body.price,
            "sealed_premium": round(body.price / float(prod["msrp"]), 2)}
