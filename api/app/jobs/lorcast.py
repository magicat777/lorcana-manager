"""Shared Lorcast API client for the seed and price-refresh jobs."""
import time

import httpx

from .. import config


def get(client: httpx.Client, path: str, params: dict | None = None) -> dict:
    time.sleep(config.LORCAST_DELAY_S)
    r = client.get(f"{config.LORCAST_BASE}{path}", params=params or {})
    r.raise_for_status()
    return r.json()


def fetch_sets(client: httpx.Client) -> list[dict]:
    return get(client, "/sets")["results"]


def fetch_set_cards(client: httpx.Client, code: str) -> list[dict]:
    """All prints for a set. Lorcast currently returns a whole set in one page;
    follow page params defensively in case pagination appears."""
    cards: list[dict] = []
    page = 1
    while True:
        data = get(client, "/cards/search",
                   {"q": f"set:{code}", "unique": "prints", "page": page})
        results = data.get("results", [])
        cards.extend(results)
        if not data.get("has_more") or not results:
            return cards
        page += 1
