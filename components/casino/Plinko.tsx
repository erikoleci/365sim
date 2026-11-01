import React, { useEffect, useRef, useState } from 'react';
import { casinoPlinkoConfig, casinoPlinkoDrop, PlinkoRisk } from '../../services/api';
import ChipBet from './ChipBet';
import CoinBurst from './CoinBurst';
import './casino.css';

interface Props { onSetBalance: (balance: number) => void; userBalance: number; onClose: () => void }
const W = 360, H = 360, TOP = 24, BOTTOM = 40;

const Plinko: React.FC<Props> = ({ onSetBalance, userBalance, onClose }) => {
  const [rows, setRows] = useState(12);
  const [risk, setRisk] = useState<PlinkoRisk>('MEDIUM');
  const [tables, setTables] = useState<Record<string, number[]>>({});
  const [stake, setStake] = useState(25);
  const [busy, setBusy] = useState(false);
  const [ball, setBall] = useState<{ x: number; y: number } | null>(null);
  const [landed, setLanded] = useState<number | null>(null);
  const [message, setMessage] = useState('Zgjidh rrezikun dhe lësho topin');
  const [burst, setBurst] = useState(0);
  const timer = useRef<number | null>(null);
  useEffect(() => { casinoPlinkoConfig().then((c) => setTables(c.tables)).catch(() => {}); return () => { if (timer.current) window.clearInterval(timer.current); }; }, []);

  const mults = tables[`${rows}-${risk}`] || [];
  const gapX = (W - 40) / (rows + 1), gapY = (H - TOP - BOTTOM) / (rows + 1);
  const pegX = (r: number, i: number) => W / 2 + (i - r / 2) * gapX;
  const pegY = (r: number) => TOP + (r + 1) * gapY;

  const drop = async () => {
    if (busy || stake < 1) return;
    if (userBalance < stake) { setMessage('Insufficient Funds'); return; }
    setBusy(true); setLanded(null);
    try {
      const res = await casinoPlinkoDrop(stake, risk, rows);
      // animate along the server's path: start above the first peg, one hop per row
      const pts: { x: number; y: number }[] = [{ x: W / 2, y: TOP - 8 }];
      let rights = 0;
      res.path.forEach((d, r) => { rights += d; pts.push({ x: W / 2 + (rights - (r + 1) / 2) * gapX, y: pegY(r) + gapY / 2 }); });
      pts.push({ x: W / 2 + (res.bucket - rows / 2) * gapX, y: H - BOTTOM + 10 });
      let step = 0; setBall(pts[0]);
      timer.current = window.setInterval(() => {
        step += 1;
        if (step >= pts.length) {
          if (timer.current) window.clearInterval(timer.current);
          setBall(null); setLanded(res.bucket); setBusy(false);
          onSetBalance(res.balance);
          if (res.payout > stake) { setBurst((n) => n + 1); setMessage(`${res.multiplier}x - fitove ${res.payout.toFixed(2)} L`); }
          else setMessage(`${res.multiplier}x - ${res.payout.toFixed(2)} L`);
          return;
        }
        setBall(pts[step]);
      }, 140);
    } catch (e: any) { setMessage(e?.message || 'Gabim'); setBusy(false); }
  };

  return (
    <div className="casino-felt flex flex-col items-center min-h-[600px] rounded-xl p-4 relative overflow-hidden text-white">
      {burst > 0 && <CoinBurst key={burst} />}
      <button onClick={onClose} className="absolute top-4 left-4 text-white/50 hover:text-white font-bold z-10">‹ Exit</button>
      <h2 className="font-bold tracking-widest casino-gold-text mb-2">PLINKO</h2>
      <div className="flex gap-2 mb-2 text-xs">
        {(['LOW', 'MEDIUM', 'HIGH'] as PlinkoRisk[]).map((r) => <button key={r} disabled={busy} onClick={() => setRisk(r)} className={`px-3 py-1 rounded ${risk === r ? 'bg-yellow-500 text-black font-bold' : 'bg-white/10'}`}>{r}</button>)}
        {[8, 12, 16].map((n) => <button key={n} disabled={busy} onClick={() => setRows(n)} className={`px-3 py-1 rounded ${rows === n ? 'bg-yellow-500 text-black font-bold' : 'bg-white/10'}`}>{n} rreshta</button>)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-md" style={{ perspective: 600 }}>
        {Array.from({ length: rows }, (_, r) => Array.from({ length: r + 2 }, (_, i) => <circle key={`${r}-${i}`} cx={pegX(r + 1, i)} cy={pegY(r)} r={3} fill="#e5e7eb" />))}
        {mults.map((m, k) => (
          <g key={k}>
            <rect x={W / 2 + (k - rows / 2) * gapX - gapX / 2 + 1} y={H - BOTTOM + 14} width={gapX - 2} height={22} rx={4} fill={landed === k ? '#facc15' : m >= 2 ? '#7f1d1d' : m >= 1 ? '#1e3a8a' : '#374151'} />
            <text x={W / 2 + (k - rows / 2) * gapX} y={H - BOTTOM + 29} textAnchor="middle" fontSize={rows > 12 ? 7 : 9} fill={landed === k ? '#000' : '#fff'} fontWeight="bold">{m}x</text>
          </g>
        ))}
        {ball && <circle cx={ball.x} cy={ball.y} r={6} fill="#facc15" stroke="#fff" strokeWidth={1.5} style={{ transition: 'cx .14s linear, cy .14s ease-in' }} />}
      </svg>
      <div key={message} className="text-lg font-bold my-2 win-pop">{message}</div>
      <div className="w-full max-w-lg bg-black/30 p-3 rounded-xl border-t border-white/10 flex items-center justify-between gap-3">
        <div><div className="text-xs opacity-70">Balance</div><div className="font-bold text-yellow-400">{userBalance.toFixed(2)}</div></div>
        <ChipBet stake={stake} onChange={setStake} disabled={busy} />
        <button onClick={drop} disabled={busy} className="bg-yellow-500 hover:bg-yellow-400 text-black font-bold px-6 py-2 rounded-full disabled:opacity-50">DROP</button>
      </div>
    </div>
  );
};
export default Plinko;
