-- 004: order lines can be counted in packs or in whole cases.
-- qty_cases holds the number; qty_unit says what it counts. Existing rows were
-- all counted in packs, which is exactly the default, so nothing changes for
-- orders already on the books. (The column keeps its old name — renaming it
-- would break every in-flight query for no functional gain.)
ALTER TABLE order_lines ADD COLUMN IF NOT EXISTS qty_unit TEXT NOT NULL DEFAULT 'pack';

DO $$ BEGIN
  ALTER TABLE order_lines ADD CONSTRAINT order_lines_qty_unit_chk
    CHECK (qty_unit IN ('pack','case'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
