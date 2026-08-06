-- Official Lorcana news items, fetched daily from disneylorcana.com (Ravensburger).
-- Append-mostly: url is the identity; refetches update title/summary in place.
-- first_seen_at drives the brief's "new since yesterday" flag.
CREATE TABLE IF NOT EXISTS news_items (
  id            bigserial PRIMARY KEY,
  source        text NOT NULL,           -- 'disneylorcana'
  url           text NOT NULL UNIQUE,
  title         text NOT NULL,
  category      text,                    -- site's label: News, Strategy, ...
  summary       text,
  image_url     text,
  published_at  date,                    -- site's display date
  first_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS news_items_pub_idx
  ON news_items (published_at DESC NULLS LAST, id DESC);
