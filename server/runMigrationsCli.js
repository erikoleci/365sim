// `npm run migrate` -- applies any pending migrations/*.sql files and exits.
// Useful for running a migration manually/in CI before a deploy, separate
// from the automatic run that also happens on every server boot
// (see server.js).
import { pool } from './db.js';
import { runMigrations } from './migrate.js';

runMigrations(pool)
  .then((result) => {
    if (result.applied.length === 0) console.log('[migrate] up to date, nothing to apply');
    else console.log('[migrate] applied:', result.applied.join(', '));
    process.exit(0);
  })
  .catch((err) => {
    console.error('[migrate] failed:', err);
    process.exit(1);
  });
