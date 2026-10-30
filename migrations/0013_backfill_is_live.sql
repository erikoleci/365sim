-- Tickets placed before bets.is_live existed: a ticket counts as live when any of its matches had already
-- started when the ticket was placed. Old matches that were pruned from matches_cache stay as they are.
-- Wrapped so an unparsable start_time can never stop the server from starting.
DO $$
BEGIN
  UPDATE bets b SET is_live = TRUE
  WHERE NOT b.is_live AND EXISTS (
    SELECT 1 FROM bet_selections s
    JOIN matches_cache m ON m.id = s.match_id
    WHERE s.bet_id = b.id AND m.start_time::timestamptz <= to_timestamp(b.created_at / 1000.0)
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'is_live backfill skipped: %', SQLERRM;
END $$;
