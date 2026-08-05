-- One-time bootstrap: role + database for the Lorcana app.
-- Run as the odin-prime Postgres admin against the 'postgres' database:
--   psql -v LORCANA_DB_PASSWORD="$LORCANA_DB_PASSWORD" -f 000_role_db.sql
-- Idempotent: safe to re-run; also re-syncs the role password to the secret.

SELECT format('CREATE ROLE lorcana LOGIN PASSWORD %L', :'LORCANA_DB_PASSWORD')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'lorcana')
\gexec

SELECT format('ALTER ROLE lorcana LOGIN PASSWORD %L', :'LORCANA_DB_PASSWORD')
\gexec

SELECT 'CREATE DATABASE lorcana OWNER lorcana'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'lorcana')
\gexec
