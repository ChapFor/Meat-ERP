-- Chapel Ford Meat ERP — Phase 1 schema
-- Postgres 14+

CREATE TABLE products (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,          -- internal item code, goes in AI (91)
  name        TEXT NOT NULL,
  unit        TEXT NOT NULL DEFAULT 'lb',    -- lb | case | each
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE lots (
  id          SERIAL PRIMARY KEY,
  lot_code    TEXT NOT NULL UNIQUE,          -- e.g. 260812-B2 (pack date + batch within day)
  pack_date   DATE NOT NULL,
  batch_no    INT  NOT NULL,                 -- batch within the day
  species     TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pack_date, batch_no)
);

CREATE TYPE case_status AS ENUM ('PENDING','IN_STOCK','ALLOCATED','SHIPPED','VOID');

CREATE TABLE cases (
  id            SERIAL PRIMARY KEY,
  serial        TEXT NOT NULL UNIQUE,        -- AI (21)
  product_id    INT NOT NULL REFERENCES products(id),
  lot_id        INT NOT NULL REFERENCES lots(id),
  net_weight_lb NUMERIC(7,2) NOT NULL CHECK (net_weight_lb > 0),
  status        case_status NOT NULL DEFAULT 'PENDING',
  printed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  scanned_in_at TIMESTAMPTZ,
  voided_at     TIMESTAMPTZ,
  void_reason   TEXT,
  order_line_id INT,                          -- set when ALLOCATED / SHIPPED
  shipped_at    TIMESTAMPTZ
);
CREATE INDEX idx_cases_status  ON cases(status);
CREATE INDEX idx_cases_product ON cases(product_id);
CREATE INDEX idx_cases_lot     ON cases(lot_id);

CREATE TABLE customers (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  contact     TEXT,
  email       TEXT,
  phone       TEXT,
  notes       TEXT,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE order_status AS ENUM ('OPEN','PACKING','PACKED','SHIPPED','INVOICED','CANCELLED');

CREATE TABLE orders (
  id          SERIAL PRIMARY KEY,
  customer_id INT NOT NULL REFERENCES customers(id),
  po_number   TEXT,
  order_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  ship_date   DATE,
  status      order_status NOT NULL DEFAULT 'OPEN',
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE order_lines (
  id          SERIAL PRIMARY KEY,
  order_id    INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  INT NOT NULL REFERENCES products(id),
  qty_cases   INT,                            -- either/both may be set
  qty_lb      NUMERIC(9,2),
  notes       TEXT
);
CREATE INDEX idx_lines_order ON order_lines(order_id);

ALTER TABLE cases
  ADD CONSTRAINT fk_cases_order_line
  FOREIGN KEY (order_line_id) REFERENCES order_lines(id);

-- audit trail of every pack scan
CREATE TABLE pack_scans (
  id            SERIAL PRIMARY KEY,
  case_id       INT NOT NULL REFERENCES cases(id),
  order_line_id INT NOT NULL REFERENCES order_lines(id),
  scanned_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  undone        BOOLEAN NOT NULL DEFAULT FALSE
);
