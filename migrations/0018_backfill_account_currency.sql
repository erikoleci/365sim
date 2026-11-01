-- Old accounts were all opened as 'BOTH'. An agent / player who only ever held or played lek is now lek-only,
-- one who only ever held or played euro is euro-only. An account with both (or with no history at all) stays 'BOTH'.
-- An admin can change any of them afterwards (PATCH /api/admin/users/:id/currency).
WITH usage AS (
  SELECT u.id,
         (u.balance <> 0 OR EXISTS (SELECT 1 FROM bets b WHERE b.user_id = u.id AND COALESCE(b.currency, 'ALL') = 'ALL')) AS has_lek,
         (u.balance_eur <> 0 OR EXISTS (SELECT 1 FROM bets b WHERE b.user_id = u.id AND b.currency = 'EUR')) AS has_eur
    FROM users u
   WHERE u.role IN ('USER', 'AGENT') AND u.account_currency = 'BOTH'
)
UPDATE users SET account_currency = CASE WHEN usage.has_lek AND NOT usage.has_eur THEN 'ALL' ELSE 'EUR' END
  FROM usage
 WHERE users.id = usage.id AND usage.has_lek <> usage.has_eur;
