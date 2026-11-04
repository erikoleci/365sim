-- Sequential ticket number (1, 2, 3, ...) shown to people instead of the tail of the random id.
-- Existing tickets are numbered by placement time; new ones take the next value from the sequence.
CREATE SEQUENCE IF NOT EXISTS bets_ticket_no_seq;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS ticket_no BIGINT;
UPDATE bets SET ticket_no = s.rn
  FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn FROM bets) s
 WHERE bets.id = s.id AND bets.ticket_no IS NULL;
SELECT setval('bets_ticket_no_seq', COALESCE((SELECT MAX(ticket_no) FROM bets), 0) + 1, false);
ALTER TABLE bets ALTER COLUMN ticket_no SET DEFAULT nextval('bets_ticket_no_seq');
CREATE UNIQUE INDEX IF NOT EXISTS idx_bets_ticket_no ON bets (ticket_no);
