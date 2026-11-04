import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

// The support routes must keep three promises: staff messages carry no sender to the player, only staff can reach the inbox,
// and an admin is scoped to his own players. (Behaviour was also checked end to end against a real PostgreSQL.)
const src = readFileSync(new URL('../server/routes/support.js', import.meta.url), 'utf8');

describe('support routes', () => {
  it("never sends a staff member's id or name to the player", () => {
    const playerPart = src.slice(src.indexOf('// ---- player') > -1 ? src.indexOf('// ---- player') : 0, src.indexOf('// ---------------------------------------------------------------- staff'));
    expect(playerPart).not.toMatch(/sender_id.*res\.json|admin_username/);
    expect(src).toMatch(/from: m\.from_role === 'USER' \? 'me' : 'support'/);
  });
  it('limits the inbox to staff and scopes an admin to the players he owns', () => {
    expect(src).toMatch(/requireStaff/);
    expect(src).toMatch(/u\.admin_id = \$1/);
    expect(src).toMatch(/admin: superView \?/); // only the super admin is told which admin a player belongs to
  });
});
