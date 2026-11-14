import { describe, it, expect, vi } from 'vitest';

const notifyStaffDevices = vi.fn(async () => ({ targets: 0, sent: 0 }));
vi.mock('../server/webPush.js', () => ({ notifyStaffDevices }));

const { notifySupportInBackground } = await import('../server/supportNotify.js');

describe('support notification reaches Web Push without ntfy/Telegram env', () => {
  it('passes the player admin and an important flag', async () => {
    const pool = { query: vi.fn(async () => ({ rows: [{ username: 'lojtar1', name: 'Test', admin_id: 'adm-1' }] })) };
    notifySupportInBackground(pool, { userId: 'u1', ticketNo: 7, matchLabel: 'A - B', body: 'dua terheqje', isNew: true });
    await vi.waitFor(() => expect(notifyStaffDevices).toHaveBeenCalled());
    const arg = notifyStaffDevices.mock.calls[0][0];
    expect(arg.adminId).toBe('adm-1');
    expect(arg.payload.important).toBe(true);
    expect(arg.payload.title).toContain('lojtar1');
  });
});
