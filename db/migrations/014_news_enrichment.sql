-- News enrichment: high-signal items (rotation, banlist/errata, release notes,
-- new-set detection) get a signal tag and their article body captured for the
-- brief. signal: 'rules' (fetched+classified) | 'new-set' (Lorcast diff).
ALTER TABLE news_items ADD COLUMN IF NOT EXISTS signal text;
ALTER TABLE news_items ADD COLUMN IF NOT EXISTS body text;
