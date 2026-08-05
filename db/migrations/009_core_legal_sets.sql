-- Authoritative Core Constructed legality lives HERE, not in Lorcast's
-- legalities field (verified stale 2026-08-05: it still marked set 13 as
-- not_legal and rotated sets 5-8 as legal, contradicting the 2026-07-24
-- rotation: Core = sets 9-13 only).
--
-- MAINTENANCE: on each annual rotation (next ~July 2027) update the range
-- below and re-run migrations. New sets between rotations: extend the upper
-- bound when they become tournament-legal.

ALTER TABLE sets ADD COLUMN IF NOT EXISTS core_legal boolean NOT NULL DEFAULT false;

-- COALESCE: promo/special sets have set_num NULL -> not core-legal as a set
-- (promo prints of legal cards are a per-card question; deck lists built from
-- main-set prints are unaffected).
UPDATE sets SET core_legal = COALESCE(set_num BETWEEN 9 AND 13, false);
