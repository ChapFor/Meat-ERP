-- 003: packs inside cases.
-- A pack and a case are the same shape: a labeled, weighed, scannable unit with
-- a lifecycle. So instead of a parallel packs table, cases self-reference:
--   parent_id NULL + no children  -> a standalone unit (a whole chicken, or a
--                                    loose pack) — exactly today's behaviour
--   parent_id NULL + has children -> a container case (a box of packs)
--   parent_id set                 -> a pack inside that container
-- Inventory counts leaves only, so a container never double-counts its packs.
ALTER TABLE cases ADD COLUMN IF NOT EXISTS parent_id INT REFERENCES cases(id);
CREATE INDEX IF NOT EXISTS idx_cases_parent ON cases(parent_id);
