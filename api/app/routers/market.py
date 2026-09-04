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
