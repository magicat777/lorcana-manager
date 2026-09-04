import os

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://lorcana:lorcana@localhost:5432/lorcana",
)
LORCAST_BASE = os.getenv("LORCAST_BASE", "https://api.lorcast.com/v0")
# Courtesy delay between Lorcast requests (they ask for 50-100ms; we go slower).
LORCAST_DELAY_S = float(os.getenv("LORCAST_DELAY_S", "0.25"))

# Next Core Constructed rotation date (ISO, e.g. 2027-07-01). Set when
# Ravensburger announces it; the brief counts down inside 90 days. Unset = no
# countdown. Remember to also update db/migrations/009_core_legal_sets.sql on
# rotation day.
NEXT_ROTATION = os.getenv("LORCANA_NEXT_ROTATION", "")

# Comprehensive Rules ingestion (jobs/seed_rules.py). The PDF URL is
# versioned per release, so unset means: discover the current link from the
# official resources page. Set LORCANA_CR_URL to pin a specific PDF.
CR_URL = os.getenv("LORCANA_CR_URL", "")
CR_RESOURCES_URL = os.getenv("LORCANA_CR_RESOURCES_URL",
                             "https://www.disneylorcana.com/en-US/resources/")

# Market-signal knobs (brief buy triggers on want-list singles).
# A playable single's price ceiling = weekly budget × Thursdays the set has
# left in Core; Core life is estimated as release + horizon (set 13, released
# 2026-07-17, lands at summer 2028 with the 2-year default). Adjust the
# horizon when Ravensburger announces real per-set rotation dates.
WEEKLY_BUDGET_USD = float(os.getenv("LORCANA_WEEKLY_BUDGET_USD", "0.60"))
ROTATION_HORIZON_YEARS = float(os.getenv("LORCANA_ROTATION_HORIZON_YEARS", "2"))

# Home coordinates for nearest-first venue sorting. Deliberately env-only
# (set in the lorcana-db secret, never in this public repo); unset = venues
# sort alphabetically.
HOME_LAT = float(os.environ["LORCANA_HOME_LAT"]) if os.getenv("LORCANA_HOME_LAT") else None
HOME_LON = float(os.environ["LORCANA_HOME_LON"]) if os.getenv("LORCANA_HOME_LON") else None
