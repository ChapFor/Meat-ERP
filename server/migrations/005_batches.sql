-- 005: batch manufacturing.
-- (Requested as 002_batches.sql, but 002 is the customer directory and the
--  runner applies files in filename order, so this takes the next free number.)
--
-- A batch turns input weight into labelled output. The batch owns one lot; the
-- station prints into that lot, so every case produced is attributable to the
-- batch that made it, and lots.parent_lot_id carries traceability back to the
-- carcass lot the input came from.
-- Additive only.

DO $$ BEGIN CREATE TYPE batch_type AS ENUM ('CUT','FORMULATE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE batch_status AS ENUM ('OPEN','CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS production_batches (
  id              SERIAL PRIMARY KEY,
  batch_type      batch_type   NOT NULL,
  lot_id          INT          NOT NULL REFERENCES lots(id),
  input_weight_lb NUMERIC(10,2),            -- carcass / raw weight in
  bird_count      INT,
  status          batch_status NOT NULL DEFAULT 'OPEN',
  opened_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  closed_at       TIMESTAMPTZ,
  notes           TEXT
);
CREATE INDEX IF NOT EXISTS idx_batches_lot    ON production_batches(lot_id);
CREATE INDEX IF NOT EXISTS idx_batches_status ON production_batches(status);

CREATE TABLE IF NOT EXISTS batch_inputs (
  id         SERIAL PRIMARY KEY,
  batch_id   INT NOT NULL REFERENCES production_batches(id) ON DELETE CASCADE,
  product_id INT REFERENCES products(id),
  case_id    INT REFERENCES cases(id),       -- set when the input was scanned in
  qty        NUMERIC(10,2) NOT NULL,
  unit       TEXT NOT NULL DEFAULT 'lb' CHECK (unit IN ('lb','each')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_batch_inputs_batch ON batch_inputs(batch_id);

CREATE TABLE IF NOT EXISTS recipes (
  id                SERIAL PRIMARY KEY,
  name              TEXT NOT NULL,
  output_product_id INT NOT NULL REFERENCES products(id),
  base_lb           NUMERIC(10,2) NOT NULL,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recipe_lines (
  id         SERIAL PRIMARY KEY,
  recipe_id  INT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  product_id INT NOT NULL REFERENCES products(id),
  qty        NUMERIC(10,2) NOT NULL,
  unit       TEXT NOT NULL DEFAULT 'lb' CHECK (unit IN ('lb','each'))
);
CREATE INDEX IF NOT EXISTS idx_recipe_lines_recipe ON recipe_lines(recipe_id);

-- an output lot points back at the lot its input came from
ALTER TABLE lots ADD COLUMN IF NOT EXISTS parent_lot_id INT REFERENCES lots(id);

-- Needed for "cost allocation by relative market value": the basis is each
-- product's market value per lb, and dollars only exist if the batch carries an
-- input cost. Both are optional — without them the yield report still gives
-- weights and yield %, and value shares appear as soon as prices are set.
ALTER TABLE products          ADD COLUMN IF NOT EXISTS market_value_per_lb NUMERIC(10,4);
ALTER TABLE production_batches ADD COLUMN IF NOT EXISTS input_cost NUMERIC(12,2);
