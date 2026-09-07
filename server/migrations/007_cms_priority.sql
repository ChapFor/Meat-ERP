-- 007: hand-ordered customer priority for the floor cut list.
--
-- The floor decides which customers get cut first, and that order has to be the
-- same on the wall tablet and in the office — so it is dragged once and stored
-- here rather than kept in each browser. Keyed by the CMS customer name because
-- that is all the cut list has; a renamed customer simply drops back to
-- unranked. Additive only.

CREATE TABLE IF NOT EXISTS cms_priority (
  customer   TEXT PRIMARY KEY,
  position   INT  NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
