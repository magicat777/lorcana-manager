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

# Home coordinates for nearest-first venue sorting. Deliberately env-only
# (set in the lorcana-db secret, never in this public repo); unset = venues
# sort alphabetically.
HOME_LAT = float(os.environ["LORCANA_HOME_LAT"]) if os.getenv("LORCANA_HOME_LAT") else None
HOME_LON = float(os.environ["LORCANA_HOME_LON"]) if os.getenv("LORCANA_HOME_LON") else None
