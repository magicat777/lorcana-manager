-- Venue registry for the match log. Slugs are stable identifiers — never change
-- them; events.venue_id references this table. active=false instead of DELETE so
-- historical events keep resolving. Idempotent.

CREATE TABLE IF NOT EXISTS venues (
  id            bigserial PRIMARY KEY,
  slug          text NOT NULL UNIQUE,
  name          text NOT NULL,
  city          text NOT NULL,
  state         text NOT NULL DEFAULT 'CA',
  display_name  text NOT NULL,        -- "Game Kastle — Redwood City" (stored, not derived)
  address       text,
  lat           double precision,
  lon           double precision,
  active        boolean NOT NULL DEFAULT true,
  event_night   text,                 -- 'thursday' etc., once known
  event_time    text,                 -- '18:30'
  notes         text
);

ALTER TABLE events ADD COLUMN IF NOT EXISTS venue_id bigint REFERENCES venues(id);
CREATE INDEX IF NOT EXISTS events_venue_idx ON events (venue_id);

INSERT INTO venues (slug, name, city, state, display_name) VALUES
  ('destine-fantasy-alameda',  'Destine Fantasy Games', 'Alameda',       'CA', 'Destine Fantasy Games — Alameda'),
  ('dogpatch-games-sf',        'Dogpatch Games',        'San Francisco', 'CA', 'Dogpatch Games — San Francisco'),
  ('game-kastle-redwood-city', 'Game Kastle',           'Redwood City',  'CA', 'Game Kastle — Redwood City'),
  ('gamescape-sf',             'GamescapeSF',           'San Francisco', 'CA', 'GamescapeSF — San Francisco'),
  ('victory-point-berkeley',   'Victory Point Cafe',    'Berkeley',      'CA', 'Victory Point Cafe — Berkeley'),
  ('game-kastle-fremont',      'Game Kastle',           'Fremont',       'CA', 'Game Kastle — Fremont'),
  ('angry-goose-san-lorenzo',  'Angry Goose Games',     'San Lorenzo',   'CA', 'Angry Goose Games — San Lorenzo'),
  ('game-parlor-sf',           'The Game Parlor',       'San Francisco', 'CA', 'The Game Parlor — San Francisco'),
  ('mojobreak-santa-clara',    'Mojobreak',             'Santa Clara',   'CA', 'Mojobreak — Santa Clara'),
  ('anime-imports-pacifica',   'Anime Imports LLC',     'Pacifica',      'CA', 'Anime Imports LLC — Pacifica'),
  ('gamelandia-palo-alto',     'Gamelandia',            'Palo Alto',     'CA', 'Gamelandia — Palo Alto'),
  ('games-of-fremont',         'Games of Fremont',      'Fremont',       'CA', 'Games of Fremont — Fremont')
ON CONFLICT (slug) DO NOTHING;
