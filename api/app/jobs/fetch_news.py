"""Fetch official Lorcana news into news_items (daily CronJob, runs before the
brief so fresh items land in the morning push).

Sources are server-rendered pages parsed with regexes — no headless browser.
disneylorcana.com (Ravensburger) is a Nuxt site whose news grid ships fully
rendered card markup; add further official channels to SOURCES as they appear.
Refetching is idempotent: url is the identity, title/summary refresh in place,
first_seen_at is set once and marks an item "new" for the next brief.

Enrichment: items whose title/summary matches SIGNAL_RE (rotation, banlist,
errata, release notes) are tagged signal='rules' and their article body is
fetched once. A Lorcast sets-diff also surfaces brand-new sets as synthetic
signal='new-set' items ("run the seed job") — keyword-free and reliable."""
import html as htmllib
import re
import time
from datetime import datetime

import httpx

from .. import db
from . import lorcast

UA = "Mozilla/5.0 (X11; Linux x86_64) lorcana-collection/1.0 (personal news digest)"

SIGNAL_RE = re.compile(
    r"rotation|ban\s?list|errat|release notes|rules (?:update|change|clarif)"
    r"|format (?:update|change)|no longer legal", re.I)

CARD_RE = re.compile(
    r'<a href="(?P<url>https://www\.disneylorcana\.com/en-US/news_[^"]+)"[^>]*'
    r'class="card">(?P<body>.*?)</a>', re.S)
FIELD_RES = {
    "image_url": re.compile(r'<img src="([^"]+)"'),
    "date": re.compile(r'<p class="date">([^<]*)</p>'),
    "category": re.compile(r'<p class="category">([^<]*)</p>'),
    "title": re.compile(r'<h1 class="heading">([^<]*)</h1>'),
    "summary": re.compile(r'<p class="description">([^<]*)</p>'),
}


def parse_disneylorcana(page: str) -> list[dict]:
    items, seen = [], set()
    for m in CARD_RE.finditer(page):
        url, body = m.group("url"), m.group("body")
        if url in seen:
            continue
        seen.add(url)
        fields = {}
        for key, rx in FIELD_RES.items():
            fm = rx.search(body)
            fields[key] = htmllib.unescape(fm.group(1)).strip() if fm else None
        if not fields["title"]:
            continue
        published = None
        if fields["date"]:
            try:
                published = datetime.strptime(fields["date"], "%B %d, %Y").date()
            except ValueError:
                pass
        items.append({
            "source": "disneylorcana", "url": url, "title": fields["title"],
            "category": fields["category"], "summary": fields["summary"],
            "image_url": fields["image_url"], "published_at": published,
        })
    return items


SOURCES = [
    ("disneylorcana", "https://www.disneylorcana.com/en-US/news", parse_disneylorcana),
]


def extract_article(page: str, cap: int = 12000) -> str:
    """Readable text from an article page: paragraph/heading/list elements,
    skipping the nav blob (first block that reads like a sentence starts the
    article) and the © footer."""
    page = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", page, flags=re.S)
    blocks = []
    for raw in re.findall(r"<(?:p|h2|h3|li)[^>]*>(.*?)</(?:p|h2|h3|li)>", page, flags=re.S):
        t = re.sub(r"<[^>]+>", "", raw)
        t = re.sub(r"\s+", " ", htmllib.unescape(t)).strip()
        if t:
            blocks.append(t)
    start = 0
    for i, t in enumerate(blocks):
        if len(t) > 60 and t.rstrip('"”’') .endswith((".", "!", "?", ")")):
            start = i
            break
    body = []
    for t in blocks[start:]:
        if t.startswith("© Disney") or t.startswith("Privacy Policy"):
            break
        body.append(t)
    return "\n".join(body)[:cap]


def enrich_signal_items() -> int:
    """Tag rules-signal items and fetch their article body once."""
    rows = db.query(
        """SELECT id, url, title, coalesce(summary,'') AS summary FROM news_items
           WHERE source='disneylorcana' AND body IS NULL""")
    enriched = 0
    for r in rows:
        if not SIGNAL_RE.search(f"{r['title']} {r['summary']}"):
            continue
        time.sleep(1.0)  # politeness between article fetches
        try:
            resp = httpx.get(r["url"], headers={"User-Agent": UA},
                             timeout=30, follow_redirects=True)
            resp.raise_for_status()
            body = extract_article(resp.text)
        except httpx.HTTPError as e:
            print(f"  signal item {r['id']}: body fetch failed ({e}); will retry next run")
            continue
        db.execute("UPDATE news_items SET signal='rules', body=%s WHERE id=%s",
                   (body, r["id"]))
        enriched += 1
        print(f"  ⚠ rules-signal: {r['title']} ({len(body)} chars captured)")
    return enriched


def detect_new_sets() -> int:
    """Diff Lorcast's set list against ours; surface unknown sets as synthetic
    news items so the brief says 'run the seed job'."""
    known = {r["code"] for r in db.query("SELECT code FROM sets")}
    found = 0
    with httpx.Client() as client:
        sets = lorcast.fetch_sets(client)
    for s in sets:
        if s["code"] in known:
            continue
        row = db.query_one(
            """INSERT INTO news_items (source, url, title, category, summary,
                                       published_at, signal)
               VALUES ('lorcast', %s, %s, 'New set', %s, %s, 'new-set')
               ON CONFLICT (url) DO NOTHING RETURNING id""",
            (f"https://lorcast.com/sets/{s['code']}",
             f"New set on Lorcast: {s['name']} ({s['code']})",
             "Not yet in the local catalog — run the seed job "
             "(kubectl apply -f deploy/jobs/seed-job.yaml).",
             s.get("released_at")))
        if row:
            found += 1
            print(f"  ⚠ new set detected: {s['name']} ({s['code']})")
    return found


def run() -> None:
    db.pool.open()
    total, new = 0, 0
    for name, url, parse in SOURCES:
        r = httpx.get(url, headers={"User-Agent": UA}, timeout=30, follow_redirects=True)
        r.raise_for_status()
        items = parse(r.text)
        if not items:
            # Parser found nothing on a 200 page — almost certainly a site
            # redesign broke the regexes; fail loudly rather than log success.
            raise RuntimeError(f"{name}: 0 items parsed from {url}")
        with db.pool.connection() as conn:
            for it in items:
                row = conn.execute(
                    """INSERT INTO news_items
                         (source, url, title, category, summary, image_url, published_at)
                       VALUES (%(source)s, %(url)s, %(title)s, %(category)s,
                               %(summary)s, %(image_url)s, %(published_at)s)
                       ON CONFLICT (url) DO UPDATE SET
                         title=EXCLUDED.title, category=EXCLUDED.category,
                         summary=EXCLUDED.summary, image_url=EXCLUDED.image_url,
                         published_at=COALESCE(EXCLUDED.published_at, news_items.published_at)
                       RETURNING (xmax = 0) AS inserted""", it).fetchone()
                new += bool(row["inserted"])
            conn.commit()
        total += len(items)
        print(f"{name}: {len(items)} items on page")
    enriched = enrich_signal_items()
    new_sets = detect_new_sets()
    print(f"news fetch done: {total} items seen, {new} new, "
          f"{enriched} rules bodies captured, {new_sets} new sets detected")


if __name__ == "__main__":
    run()
