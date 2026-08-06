"""Fetch official Lorcana news into news_items (daily CronJob, runs before the
brief so fresh items land in the morning push).

Sources are server-rendered pages parsed with regexes — no headless browser.
disneylorcana.com (Ravensburger) is a Nuxt site whose news grid ships fully
rendered card markup; add further official channels to SOURCES as they appear.
Refetching is idempotent: url is the identity, title/summary refresh in place,
first_seen_at is set once and marks an item "new" for the next brief."""
import html as htmllib
import re
from datetime import datetime

import httpx

from .. import db

UA = "Mozilla/5.0 (X11; Linux x86_64) lorcana-collection/1.0 (personal news digest)"

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
    print(f"news fetch done: {total} items seen, {new} new")


if __name__ == "__main__":
    run()
