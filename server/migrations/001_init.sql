-- Chapel Ford ERP v2 — initial schema.
-- Weights are lb throughout. Every printed label is one row in `cases`.

CREATE TABLE products (
  id              serial PRIMARY KEY,
  code            text NOT NULL UNIQUE CHECK (code ~ '^[0-9]{1,8}$'),  -- PLU, goes in AI (91)
  name            text NOT NULL,
  label_name      text,                       -- printed name if different from name
  tare_lb         numeric(8,2) NOT NULL DEFAULT 0,   -- subtracted from gross at the station
  min_lb          numeric(8,2),               -- out-of-spec weights are refused at the station
  max_lb          numeric(8,2),
  shelf_life_days integer,
  qbo_item_id     text UNIQUE,                -- QuickBooks Online Item.Id
  qbo_item_name   text,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Lot = one run within a day: YYMMDD-B{n}.
CREATE TABLE lots (
  id           serial PRIMARY KEY,
  code         text NOT NULL UNIQUE CHECK (code ~ '^[0-9]{6}-B[0-9]+$'),
  pack_date    date NOT NULL,
  batch_no     integer NOT NULL,
  note         text,
  status       text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  next_serial  integer NOT NULL DEFAULT 1,     -- next unleased suffix
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pack_date, batch_no)
);

-- Serial blocks handed to stations so printing never waits on the network.
CREATE TABLE serial_leases (
  id          serial PRIMARY KEY,
  lot_id      integer NOT NULL REFERENCES lots(id),
  station     text NOT NULL,
  first_no    integer NOT NULL,
  last_no     integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customers (
  id           serial PRIMARY KEY,
  qbo_id       text UNIQUE,
  name         text NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Orders are created in QuickBooks Online (Estimates) and mirrored here.
CREATE TABLE orders (
  id            serial PRIMARY KEY,
  qbo_id        text UNIQUE,
  qbo_sync_token text,
  doc_number    text NOT NULL,
  customer_id   integer REFERENCES customers(id),
  customer_name text NOT NULL,
  txn_date      date,
  ship_date     date,
  memo          text,
  status        text NOT NULL DEFAULT 'OPEN'
                CHECK (status IN ('OPEN','MANIFESTED','CANCELLED')),
  manifested_at timestamptz,
  qbo_writeback_status text,                 -- null | 'PENDING' | 'DONE' | 'ERROR'
  qbo_writeback_error  text,
  qbo_invoice_id text,
  qbo_updated_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_status_idx ON orders (status, ship_date);

CREATE TABLE order_lines (
  id            serial PRIMARY KEY,
  order_id      integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  qbo_line_id   text,
  line_no       integer NOT NULL,
  product_id    integer REFERENCES products(id),      -- null = QBO item not mapped to a PLU
  qbo_item_id   text,
  item_name     text,
  description   text,
  qty_ordered   numeric(10,2) NOT NULL,               -- cases, as entered in QuickBooks
  unit_price    numeric(10,4),                        -- $ per lb
  UNIQUE (order_id, line_no)
);

CREATE TABLE cases (
  id            bigserial PRIMARY KEY,
  serial        text NOT NULL UNIQUE,                 -- {lot}-{suffix}
  product_id    integer NOT NULL REFERENCES products(id),
  lot_id        integer NOT NULL REFERENCES lots(id),
  weight_lb     numeric(8,2) NOT NULL CHECK (weight_lb > 0),
  status        text NOT NULL DEFAULT 'IN_STOCK'
                CHECK (status IN ('IN_STOCK','ALLOCATED','SHIPPED','VOID')),
  order_line_id integer REFERENCES order_lines(id),
  station       text,
  printed_at    timestamptz NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now(),   -- when the upload reached the server
  allocated_at  timestamptz,
  shipped_at    timestamptz,
  voided_at     timestamptz,
  void_reason   text,
  print_ms      integer                               -- stable weight → printer accepted job
);
CREATE INDEX cases_status_product_idx ON cases (status, product_id);
CREATE INDEX cases_order_line_idx ON cases (order_line_id);
CREATE INDEX cases_lot_idx ON cases (lot_id);

-- Audit trail of every scan and status change.
CREATE TABLE case_events (
  id        bigserial PRIMARY KEY,
  case_id   bigint NOT NULL REFERENCES cases(id),
  event     text NOT NULL,          -- PRINTED | ALLOCATED | UNALLOCATED | SHIPPED | VOIDED
  order_id  integer REFERENCES orders(id),
  detail    text,
  at        timestamptz NOT NULL DEFAULT now()
);

-- QuickBooks Online connection (single company).
CREATE TABLE qbo_connection (
  id               integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  realm_id         text NOT NULL,
  access_token     text NOT NULL,
  refresh_token    text NOT NULL,
  access_expires   timestamptz NOT NULL,
  refresh_expires  timestamptz,
  last_sync_at     timestamptz,
  last_sync_error  text,
  connected_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE settings (
  key   text PRIMARY KEY,
  value text
);

-- Raw QuickBooks Line array, kept so a write-back can rebuild every line
-- (a sparse update replaces the whole Line list).
ALTER TABLE orders ADD COLUMN qbo_lines_raw jsonb;
