// DOG RACE: six greyhounds in traps 1-6. The finishing order is drawn on the server (same Plackett-Luce method as the horses).
export const DOG_RTP = 0.95;
export const DOGS = [
  { id: 0, name: 'Red Rocket', trap: 1, p: 0.28, color: '#ef4444' },
  { id: 1, name: 'Blue Bolt', trap: 2, p: 0.21, color: '#3b82f6' },
  { id: 2, name: 'White Shadow', trap: 3, p: 0.17, color: '#f1f5f9' },
  { id: 3, name: 'Green Flash', trap: 4, p: 0.14, color: '#22c55e' },
  { id: 4, name: 'Yellow Storm', trap: 5, p: 0.12, color: '#eab308' },
  { id: 5, name: 'Purple Comet', trap: 6, p: 0.08, color: '#a855f7' },
].map((d) => ({ ...d, odds: Math.floor((DOG_RTP / d.p) * 100) / 100 }));

export function drawOrder(randInt) {
  const left = DOGS.map((d) => ({ id: d.id, w: Math.round(d.p * 10000) }));
  const order = [];
  while (left.length) {
    const total = left.reduce((a, d) => a + d.w, 0);
    let r = randInt(total); let idx = 0;
    for (; idx < left.length; idx += 1) { if ((r -= left[idx].w) < 0) break; }
    order.push(left.splice(Math.min(idx, left.length - 1), 1)[0].id);
  }
  return order;
}
export const dogPayout = (stake, id, order) => (order[0] === id ? Math.round(stake * DOGS[id].odds * 100) / 100 : 0);
