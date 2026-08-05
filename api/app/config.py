import os

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://lorcana:lorcana@localhost:5432/lorcana",
)
LORCAST_BASE = os.getenv("LORCAST_BASE", "https://api.lorcast.com/v0")
# Courtesy delay between Lorcast requests (they ask for 50-100ms; we go slower).
LORCAST_DELAY_S = float(os.getenv("LORCAST_DELAY_S", "0.25"))
