export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users(
  id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('cutting_supervisor','cutting_verifier','sewing_supervisor')),
  full_name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS recipes(
  id SERIAL PRIMARY KEY, recipe_code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL,
  std_fabric_yards NUMERIC(8,2) NOT NULL CHECK (std_fabric_yards > 0),
  wastage_cap NUMERIC(5,2) NOT NULL);

CREATE TABLE IF NOT EXISTS recipe_components(
  id SERIAL PRIMARY KEY, recipe_id INT NOT NULL REFERENCES recipes(id), component_name TEXT NOT NULL,
  pieces_per_garment INT NOT NULL CHECK (pieces_per_garment > 0), image_url TEXT);

CREATE TABLE IF NOT EXISTS cutting_orders(
  id SERIAL PRIMARY KEY, order_no TEXT UNIQUE NOT NULL, recipe_id INT NOT NULL REFERENCES recipes(id),
  target_qty INT NOT NULL CHECK (target_qty > 0), fabric_roll_id TEXT NOT NULL,
  actual_fabric_yds NUMERIC(10,2) NOT NULL CHECK (actual_fabric_yds > 0),
  status TEXT NOT NULL CHECK (status IN ('PENDING_VERIFICATION','VERIFIED','REJECTED','SEWING_IN_PROGRESS')),
  created_by INT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS verification_items(
  id SERIAL PRIMARY KEY, order_id INT NOT NULL REFERENCES cutting_orders(id),
  component_id INT NOT NULL REFERENCES recipe_components(id), expected_qty INT NOT NULL,
  actual_qty INT CHECK (actual_qty >= 0), status TEXT CHECK (status IN ('GREEN','YELLOW','RED')),
  UNIQUE(order_id, component_id));

CREATE TABLE IF NOT EXISTS verification_logs(
  id SERIAL PRIMARY KEY, order_id INT NOT NULL REFERENCES cutting_orders(id),
  verifier_id INT NOT NULL REFERENCES users(id),
  decision TEXT NOT NULL CHECK (decision IN ('APPROVED','REJECTED')),
  rejection_note TEXT, wastage_pct NUMERIC(8,2) NOT NULL, variances JSONB NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (decision = 'APPROVED' OR length(trim(coalesce(rejection_note,''))) > 0));

-- Audit trail is append-only at the database level.
CREATE OR REPLACE FUNCTION forbid_log_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'verification_logs is immutable'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS verification_logs_immutable ON verification_logs;
CREATE TRIGGER verification_logs_immutable BEFORE UPDATE OR DELETE ON verification_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_log_mutation();
`;
