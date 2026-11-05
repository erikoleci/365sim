// HORSE RACE: six horses with fixed win chances. The server draws the full finishing order (Plackett-Luce: each place is
// drawn from the horses still running, weighted by their strength) so the winner is exactly as likely as the odds imply.
export const HORSE_RTP = 0.95;
export const HORSES = [
  { id: 0, name: 'Thunder Bolt', p: 0.30, color: '#ef4444' },
  { id: 1, name: 'Golden Arrow', p: 0.22, color: '#eab308' },
  { id: 2, name: 'Night Storm', p: 0.17, color: '#6366f1' },
  { id: 3, name: 'Emerald Wind', p: 0.14, color: '#22c55e' },
  { id: 4, name: 'Crimson Flash', p: 0.10, color: '#ec4899' },
  { id: 5, name: 'Silver Ghost', p: 0.07, color: '#94a3b8' },
].map((h) => ({ ...h, odds: Math.floor((HORSE_RTP / h.p) * 100) / 100 }));

export function drawOrder(randInt) {
  const left = HORSES.map((h) => ({ id: h.id, w: Math.round(h.p * 10000) }));
  const order = [];
  while (left.length) {
    const total = left.reduce((a, h) => a + h.w, 0);
    let r = randInt(total);
    let idx = 0;
    for (; idx < left.length; idx += 1) { if ((r -= left[idx].w) < 0) break; }
    order.push(left.splice(Math.min(idx, left.length - 1), 1)[0].id);
  }
  return order;
}
export const horsePayout = (stake, horseId, order) => (order[0] === horseId ? Math.round(stake * HORSES[horseId].odds * 100) / 100 : 0);
