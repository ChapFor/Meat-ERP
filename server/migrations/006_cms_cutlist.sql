-- 006: CMS wholesale orders pulled through to a plant-floor cut list.
--
-- Everything here is a CACHE of Custom Meat Solutions, which stays the system of
-- record for orders. We never write back to it. The floor screen reads only
-- these tables, so a CMS outage degrades to stale data rather than a blank wall
-- display. Additive only.

CREATE TABLE IF NOT EXISTS cms_orders (
  order_no        TEXT PRIMARY KEY,          -- "Shopper" column
  customer        TEXT,
  created_text    TEXT,                      -- kept as shown; formats vary
  requested_by    DATE,                      -- sort key: past due / today / upcoming
  requested_text  TEXT,
  status          TEXT,                      -- Active, Picked Up, ...
  pickup_method   TEXT,
  notes           TEXT,                      -- shown on the floor
  items_packed    INT,                       -- X of "X of Y"
  items_total     INT,                       -- Y of "X of Y"
  pre_items       INT,
  row_hash        TEXT,                      -- change detection; skips detail fetch
  detail_url      TEXT,
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  lines_synced_at TIMESTAMPTZ,
  closed_at       TIMESTAMPTZ                -- gone from the Active list; never deleted
);
CREATE INDEX IF NOT EXISTS idx_cms_orders_status ON cms_orders(status);
CREATE INDEX IF NOT EXISTS idx_cms_orders_req    ON cms_orders(requested_by);

-- Pre-Order Mode ON gives demand; OFF gives the cart, i.e. what is packed.
-- Both live here, told apart by `kind`.
CREATE TABLE IF NOT EXISTS cms_order_lines (
  id           SERIAL PRIMARY KEY,
  order_no     TEXT NOT NULL REFERENCES cms_orders(order_no) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('PREORDER','PACKED')),
  item_no      INT,
  pkg          NUMERIC(10,2),                -- packages on the line; "5 pk x 5"
  qty          NUMERIC(12,2),                -- Total Qty
  order_uom    TEXT,                         -- Each | lb — what the customer ordered in
  sold_uom     TEXT,                         -- informational
  product_name TEXT NOT NULL,                -- exact CMS text; joins to cms_products
  item_status  TEXT,
  synced_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cms_lines_order   ON cms_order_lines(order_no, kind);
CREATE INDEX IF NOT EXISTS idx_cms_lines_product ON cms_order_lines(product_name);

-- Product master the owner fills in. Unmapped products still show on the floor,
-- flagged, so nothing silently disappears from the cut list.
CREATE TABLE IF NOT EXISTS cms_products (
  product_name    TEXT PRIMARY KEY,          -- exact CMS text
  category        TEXT NOT NULL DEFAULT 'Misc',
  pieces_per_pack NUMERIC(10,2),
  birds_per_pack  NUMERIC(10,2),
  erp_product_id  INT REFERENCES products(id),   -- optional link to our own item
  notes           TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cms_sync_log (
  id          SERIAL PRIMARY KEY,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  ok          BOOLEAN,
  orders_seen INT,
  orders_read INT,                           -- detail pages actually fetched
  error       TEXT
);
CREATE INDEX IF NOT EXISTS idx_cms_sync_started ON cms_sync_log(started_at DESC);

-- Seed the mapping from the spec. Unknown pack contents stay NULL, which is what
-- makes a product show as "needs pack size" rather than silently counting wrong.
INSERT INTO cms_products (product_name, category, pieces_per_pack, birds_per_pack, notes) VALUES
  ('Boneless Breast Skin Off', 'Chicken', 2,    1,    NULL),
  ('Leg/Thigh Quarters',       'Chicken', NULL, NULL, NULL),
  ('Chicken Ground',           'Chicken', 1,    NULL, '1 lb pack'),
  ('Chicken Bone Broth',       'Chicken', 1,    0,    'stock item'),
  ('Chicken Organs',           'Chicken', NULL, NULL, 'sold by lb'),
  ('Rib Chops',                'Lamb',    NULL, 0,    'lamb primal')
ON CONFLICT (product_name) DO NOTHING;
