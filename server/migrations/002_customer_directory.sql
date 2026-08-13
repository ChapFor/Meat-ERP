-- 002: customer directory — mailing address + payment terms.
-- Additive only. name/contact/email/phone/notes already exist from 001.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address_line1 TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address_line2 TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS city          TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS state         TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS zip           TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS payment_terms TEXT;

-- order history is looked up per customer on the directory screen
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
