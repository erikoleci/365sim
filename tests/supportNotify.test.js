import { describe, it, expect, vi } from 'vitest';
import { buildSupportNotice, notifySupport, isImportantMessage } from '../server/supportNotify.js';

describe('support phone notification', () => {
  it('marks withdrawals, payments, money and urgent words as important', () => {
    for (const t of ['dua të tërheq paratë', 'kërkesë për dalje', 'bileta ime nuk u pagua, pagesë', 'urgjent ju lutem', 'ndihmë', 'withdraw']) expect(isImportantMessage(t), t).toBe(true);
    expect(isImportantMessage('përshëndetje')).toBe(false);
  });
  it('builds a short notice with the player, the ticket and the message', () => {
    const n = buildSupportNotice({ player: { name: 'Ardi', username: 'ardi1' }, ticketNo: 133, matchLabel: 'A - B', body: 'dua të tërheq', isNew: true });
    expect(n.title).toMatch(/^⚠ Support: kërkesë e re nga Ardi \(@ardi1\)$/);
    expect(n.text).toBe('[bileta #133 · A - B] dua të tërheq');
    expect(n.important).toBe(true);
  });
  it('sends to ntfy and Telegram when both are set, with an ASCII-safe title header', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, opts) => { calls.push({ url, opts }); return { ok: true }; });
    const r = await notifySupport({ title: '⚠ Support: ë', text: 'x', important: true }, { env: { NTFY_TOPIC: 'top ic', TELEGRAM_BOT_TOKEN: 'T', TELEGRAM_CHAT_ID: '5' }, fetchImpl });
    expect(r.sent.sort()).toEqual(['ntfy', 'telegram']);
    expect(calls[0].url).toBe('https://ntfy.sh/top%20ic');
    expect(calls[0].opts.headers.Title).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    expect(calls[0].opts.headers.Priority).toBe('urgent');
    expect(calls[1].url).toBe('https://api.telegram.org/botT/sendMessage');
  });
  it('sends nothing without a channel and never throws when a channel fails', async () => {
    expect((await notifySupport({ title: 't', text: 'x' }, { env: {}, fetchImpl: vi.fn() })).sent).toEqual([]);
    const bad = vi.fn(async () => { throw new Error('down'); });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await notifySupport({ title: 't', text: 'x' }, { env: { NTFY_TOPIC: 'a' }, fetchImpl: bad })).sent).toEqual([]);
    spy.mockRestore();
  });
});
