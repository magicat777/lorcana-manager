"""Parser tests for the ComicBook.com RSS source — no network, fixture only.

Runnable anywhere the app package imports (in-pod:
`kubectl -n lorcana exec deploy/lorcana-api -- python -m app.tests.test_fetch_news`).
The fixture is a trimmed copy of the real tag feed (two genuine items,
including the 2026-08-26 D23 article) plus synthetic items covering HTML
entities in titles, canonical-URL dedup across share params, and the
non-Lorcana guard."""
import datetime
from pathlib import Path

from ..jobs.fetch_news import parse_comicbook

FIXTURE = Path(__file__).parent / "fixtures" / "comicbook_feed.xml"


def main() -> None:
    items = parse_comicbook(FIXTURE.read_text())
    by_url = {i["url"]: i for i in items}

    # Real item: the D23 digital-client article that motivated the source.
    d23 = by_url[
        "https://comicbook.com/gaming/news/disney-lorcana-reveals-update-fans-have-been-waiting-for-since-launch/"]
    assert d23["title"] == "Disney Lorcana Reveals Update Fans Have Been Waiting For Since Launch"
    assert d23["published_at"] == datetime.date(2026, 8, 26)
    assert d23["source"] == "comicbook" and d23["category"] == "ComicBook.com"
    assert d23["summary"] and "D23" in d23["summary"]

    # HTML entities in the title decode; the share/utm query is stripped.
    ent = by_url["https://comicbook.com/gaming/news/entity-test-article/"]
    assert ent["title"] == 'Lorcana’s "Winterspell" & Friends & More', ent["title"]
    assert ent["summary"] == "Entities & markup galore — test."

    # Same canonical URL fetched twice (different share params) → one item,
    # first occurrence wins.
    assert sum(1 for i in items if i["url"].endswith("/entity-test-article/")) == 1
    assert ent["published_at"] == datetime.date(2026, 8, 24)

    # Non-Lorcana item is guarded out even though it's in the feed.
    assert not any("unrelated-article" in u for u in by_url), "guard failed"

    print(f"OK — {len(items)} items parsed, all assertions pass")


if __name__ == "__main__":
    main()
