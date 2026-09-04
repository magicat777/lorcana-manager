"""Comprehensive Rules lookup: full-text search and exact citation fetch over
the paragraph index that jobs/seed_rules.py maintains. Every response carries
the loaded CR version plus a staleness verdict (a set released after the CR's
effective date almost certainly shipped a CR update — rerun the seed job)."""
import re

from fastapi import APIRouter, HTTPException, Query

from .. import db

router = APIRouter(tags=["rules"])

_KEY = re.compile(r'^\d+(\.\d+)*\.?$')


def _meta() -> dict | None:
    m = db.query_one(
        """SELECT m.version, m.effective_date, m.source_url, m.rules, m.glossary,
                  m.loaded_at,
                  (SELECT max(s.released_at) FROM sets s
                    WHERE s.set_num IS NOT NULL) AS newest_set_release
           FROM cr_meta m""")
    if not m:
        return None
    # A set's CR update goes effective ~1 week before the set releases
    # (2.2.0: effective 7/9 for set 13's 7/17), so "newer set exists" alone
    # would flag every current CR. 30 days of grace separates that normal
    # pattern from a genuinely missed CR update; promo/format sets
    # (set_num NULL) never carry CR updates and are excluded.
    m["possibly_stale"] = bool(
        m["effective_date"] and m["newest_set_release"]
        and (m["newest_set_release"] - m["effective_date"]).days > 30)
    return m


@router.get("/rules/meta")
def rules_meta():
    m = _meta()
    if not m:
        raise HTTPException(404, "rules index not loaded — run the rules-seed job")
    return m


@router.get("/rules/search")
def rules_search(q: str = Query(min_length=2), limit: int = Query(12, le=40)):
    meta = _meta()
    if not meta:
        raise HTTPException(404, "rules index not loaded — run the rules-seed job")
    key = q.strip().rstrip('.')
    if _KEY.match(q.strip()):
        return {"meta": meta, "exact": _rule_with_context(key), "results": []}
    rows = db.query(
        """SELECT kind, key, title, body,
                  ts_rank(tsv, websearch_to_tsquery('english', %(q)s)) AS rank,
                  ts_headline('english', body, websearch_to_tsquery('english', %(q)s),
                              'StartSel=**, StopSel=**, MaxFragments=2, MaxWords=25') AS snippet,
                  -- an exact glossary/keyword title match belongs on top even
                  -- when rarer words outrank it
                  (lower(coalesce(title, '')) = lower(%(q)s)) AS exact_title
           FROM cr_paragraphs
           WHERE tsv @@ websearch_to_tsquery('english', %(q)s)
              OR lower(coalesce(title, '')) = lower(%(q)s)
           ORDER BY exact_title DESC, rank DESC, sort_ord
           LIMIT %(limit)s""",
        {"q": q, "limit": limit})
    return {"meta": meta, "exact": None, "results": rows}


def _rule_with_context(key: str) -> dict | None:
    row = db.query_one(
        "SELECT kind, key, title, body FROM cr_paragraphs WHERE kind IN ('rule','section') AND key = %s",
        (key,))
    if not row:
        return None
    parents = key.split('.')[:-1]
    chain = ['.'.join(key.split('.')[:i + 1]) for i in range(len(parents))]
    row["context"] = db.query(
        """SELECT kind, key, title, body FROM cr_paragraphs
           WHERE key = ANY(%s) AND kind IN ('rule', 'section') ORDER BY sort_ord""",
        (chain,)) if chain else []
    row["children"] = db.query(
        r"""SELECT kind, key, title, body FROM cr_paragraphs
           WHERE kind = 'rule' AND key ~ ('^' || %s || '\.\d+$')
           ORDER BY sort_ord""",
        (key.replace('.', r'\.'),))
    return row


@router.get("/rules/{key}")
def rule_detail(key: str):
    if not _KEY.match(key):
        raise HTTPException(400, "rule keys look like 7.4.3")
    row = _rule_with_context(key.rstrip('.'))
    if not row:
        raise HTTPException(404, f"no CR paragraph {key}")
    return {"meta": _meta(), **row}
