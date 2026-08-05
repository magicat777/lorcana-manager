"""Parse Dreamborn deck exports: lines like '4 Elsa - Spirit of Winter'."""
import re

LINE_RE = re.compile(r"^\s*(\d+)\s*x?\s+(.+?)\s*$")


def parse_deck_text(text: str) -> tuple[list[tuple[int, str]], list[str]]:
    entries, bad_lines = [], []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith(("#", "//")):
            continue
        m = LINE_RE.match(line)
        if not m:
            bad_lines.append(line)
            continue
        entries.append((int(m.group(1)), m.group(2)))
    return entries, bad_lines


def match_deck_entries(cur, entries: list[tuple[int, str]]) -> tuple[list[dict], list[dict]]:
    """Match names to prints. Prefers a print the user owns, else the earliest release."""
    cards, unmatched = [], []
    for qty, name in entries:
        cur.execute(
            """SELECT c.id, c.full_name
               FROM cards c LEFT JOIN collection col ON col.card_id = c.id
               WHERE lower(c.full_name) = lower(%s)
               ORDER BY COALESCE(col.qty_normal + col.qty_foil, 0) DESC,
                        c.released_at ASC NULLS LAST, c.id
               LIMIT 1""",
            (name.strip(),),
        )
        row = cur.fetchone()
        if row:
            cards.append({"card_id": row["id"], "qty": qty})
        else:
            unmatched.append({"qty": qty, "name": name, "reason": "no card with this name"})
    return cards, unmatched
