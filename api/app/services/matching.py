"""Resolve Dreamborn CSV rows to catalog cards.

Matching order per row:
  1. set: alias table (lower/trim) -> numeric set_num fallback
  2. card: (set_id, normalized collector number)
  3. fallback: set-scoped full_name, then unique set-scoped name
Ambiguous or unresolvable rows are reported, never guessed or dropped.
"""


def norm_number(value: str) -> str:
    v = str(value).strip().lower()
    return v.lstrip("0") or "0"


def norm_alias(value: str) -> str:
    return str(value).strip().lower()


class Matcher:
    def __init__(self, cur):
        self.cur = cur
        cur.execute("SELECT alias, set_id FROM set_aliases")
        self.aliases = {r["alias"]: r["set_id"] for r in cur.fetchall()}
        cur.execute("SELECT id, set_num FROM sets WHERE set_num IS NOT NULL")
        self.by_num = {r["set_num"]: r["id"] for r in cur.fetchall()}
        # (set_id, norm_number) -> card_id
        cur.execute("SELECT id, set_id, collector_number FROM cards")
        self.by_number: dict[tuple[str, str], str] = {}
        for r in cur.fetchall():
            self.by_number[(r["set_id"], norm_number(r["collector_number"]))] = r["id"]
        # set-scoped name lookups: value None marks ambiguity
        cur.execute("SELECT id, set_id, lower(full_name) AS fn, lower(name) AS n FROM cards")
        self.by_full: dict[tuple[str, str], str | None] = {}
        self.by_name: dict[tuple[str, str], str | None] = {}
        for r in cur.fetchall():
            for table, key in ((self.by_full, r["fn"]), (self.by_name, r["n"])):
                k = (r["set_id"], key)
                table[k] = None if k in table else r["id"]

    def resolve_set(self, value: str) -> str | None:
        alias = norm_alias(value)
        if alias in self.aliases:
            return self.aliases[alias]
        try:
            return self.by_num.get(int(alias))
        except ValueError:
            return None

    def match(self, set_value: str, number: str, name: str) -> tuple[str | None, str | None]:
        """Return (card_id, failure_reason)."""
        set_id = self.resolve_set(set_value)
        if not set_id:
            return None, f"unknown set {set_value!r}"
        card_id = self.by_number.get((set_id, norm_number(number)))
        if card_id:
            return card_id, None
        n = str(name).strip().lower()
        if n:
            for table in (self.by_full, self.by_name):
                if (set_id, n) in table:
                    hit = table[(set_id, n)]
                    if hit is None:
                        return None, f"ambiguous name {name!r} in set {set_value!r}"
                    return hit, None
        return None, f"no card #{number!r} in set {set_value!r}"
