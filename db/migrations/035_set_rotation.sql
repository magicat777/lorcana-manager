-- Per-set Core-rotation ESTIMATES (2026-09-08). Drives the "cost per legal
-- week" figures and the market-signal ceiling. These are estimates until
-- Ravensburger announces real dates: EDIT THEM HERE, not with a manual
-- UPDATE — migrations re-run on every apply.sh and reset the values to this
-- file's. Calendar (desktop coaching session, 2026-09-08): sets 9-12 rotate
-- together summer 2027; set 13 rides until summer 2028. NULL = unknown
-- (never-legal promo sets stay NULL).
-- On rotation day also edit 009_core_legal_sets.sql (the core_legal range).

ALTER TABLE sets ADD COLUMN IF NOT EXISTS rotation_est date;

UPDATE sets SET rotation_est = DATE '2027-07-01' WHERE set_num BETWEEN 9 AND 12;
UPDATE sets SET rotation_est = DATE '2028-07-01' WHERE set_num = 13;
