import React, { useCallback, useEffect, useRef, useState } from 'react';
import DogTrack, { dogProgress, RUN_OUT } from './DogTrack';
import StakeInput from './StakeInput';
import CoinBurst from './CoinBurst';
import CountUp from './CountUp';
import BigWin, { winTier } from './BigWin';
import { casinoLiveDogsState, casinoLiveDogsBet, LiveDogsState } from '../../services/api';
import { sfx, setSound, soundOn } from './slotSound';
import { raceSfx } from './raceAudio';
import './casino.css';

interface Props { onSetBalance: (balance: number) => void; userBalance: number; onClose: () => void }

// LIVE DOG RACE: one shared race every 45 seconds (30 s to bet). Everybody at the table watches the same race.
const LiveDogs: React.FC<Props> = ({ onSetBalance, userBalance, onClose }) => {
  const [st, setSt] = useState<LiveDogsState | null>(null);
  const [chip, setChip] = useState(50);
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [left, setLeft] = useState(0);
  const [progress, setProgress] = useState<number[]>([0, 0, 0, 0, 0, 0]);
  const [racing, setRacing] = useState(false);
  const [finished, setFinished] = useState<number[] | null>(null);
  const [msg, setMsg] = useState('Back your greyhounds');
  const [winAmt, setWinAmt] = useState(0);
  const [burst, setBurst] = useState(0);
  const [bigWin, setBigWin] = useState<{ tier: 1 | 2 | 3; amount: number } | null>(null);
  const [snd, setSnd] = useState(soundOn());
  const [tab, setTab] = useState<'win' | 'fc'>('win');
  const offset = useRef(0); const stRef = useRef<LiveDogsState | null>(null); const lastRound = useRef<number | null>(null);
  const racedFor = useRef<number | null>(null); const pending = useRef<LiveDogsState['settled']>([]);
  const alive = useRef(true); const raf = useRef(0);

  const run = useCallback((order: number[], startedAt: number) => {
    setRacing(true); setFinished(null);
    const finish = order.map((_, place) => 7 + place * 0.4);
    const t = Array(6).fill(0); order.forEach((id, place) => { t[id] = finish[place]; });
    const wob = Array.from({ length: 6 }, (_, i) => ({ a: 0.04 + ((i * 37) % 5) * 0.012, f: 2 + (i % 3), p: i * 1.3 }));
    const tick = () => {
      if (!alive.current) return;
      const s = Math.max(0, (Date.now() + offset.current - startedAt) / 1000);
      raceSfx.setCrowd(Math.min(1, s / 6));
      setProgress(t.map((T, i) => dogProgress(s, T, wob[i])));
      if (s >= finish[5] + RUN_OUT) {
        setProgress(t.map((T, i) => dogProgress(finish[5] + RUN_OUT, T, wob[i]))); setFinished(order); setRacing(false); raceSfx.stopGallop(); window.setTimeout(() => raceSfx.stopCrowd(), 3500);
        const mine = pending.current.filter((x) => x.order[0] === order[0]); pending.current = [];
        const staked = mine.reduce((a, x) => a + x.staked, 0); const paid = mine.reduce((a, x) => a + x.payout, 0);
        setMsg(`${stRef.current?.runners[order[0]]?.name ?? 'Dog'} wins! · Forecast ${stRef.current?.runners[order[0]]?.trap ?? order[0] + 1}-${stRef.current?.runners[order[1]]?.trap ?? order[1] + 1}`);
        raceSfx.finish(paid > 0);
        if (paid > 0) { setWinAmt(paid); setBurst((b) => b + 1); sfx.win(true); const tier = winTier(paid, staked); if (tier > 0) setBigWin({ tier: tier as 1 | 2 | 3, amount: paid }); } else if (staked > 0) sfx.stop();
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(tick);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const s = await casinoLiveDogsState();
      if (!alive.current) return;
      offset.current = s.serverNow - Date.now(); stRef.current = s; setSt(s); onSetBalance(s.balance);
      if (s.settled.length) pending.current = [...pending.current, ...s.settled];
      if (lastRound.current !== null && lastRound.current !== s.round) { setDraft({}); setProgress([0, 0, 0, 0, 0, 0]); setFinished(null); setWinAmt(0); setMsg('Back your greyhounds'); }
      lastRound.current = s.round;
      if (s.phase === 'race' && s.order && racedFor.current !== s.round) {
        racedFor.current = s.round; setMsg('And they\'re off!'); raceSfx.startCrowd(); raceSfx.gates(); window.setTimeout(() => raceSfx.startGallop(() => 0.8), 700);
        run(s.order, Math.floor((s.serverNow) / s.cycleMs) * s.cycleMs + s.betMs);
      }
    } catch { /* retry */ }
  }, [onSetBalance, run]);

  useEffect(() => { alive.current = true; refresh(); const t = window.setInterval(refresh, 1500); return () => { alive.current = false; window.clearInterval(t); cancelAnimationFrame(raf.current); raceSfx.stopAll(); }; }, [refresh]);
  useEffect(() => {
    const t = window.setInterval(() => { const s = stRef.current; if (!s) return; const el = (Date.now() + offset.current) % s.cycleMs; setLeft(el < s.betMs ? s.betMs - el : s.cycleMs - el); }, 200);
    return () => window.clearInterval(t);
  }, []);

  const betting = st?.phase === 'betting' && (Date.now() + offset.current) % (st?.cycleMs ?? 40000) < (st?.betMs ?? 25000);
  const add = (id: number | string) => { if (!betting) return; sfx.click(); setDraft((d) => ({ ...d, [id]: Math.round(((d[id] || 0) + chip) * 100) / 100 })); };
  const draftTotal = Object.values(draft).reduce((a, b) => a + b, 0);
  const place = async () => {
    if (!st || !betting || draftTotal <= 0) return;
    if (draftTotal > userBalance) { setMsg('Insufficient balance'); return; }
    try { const r = await casinoLiveDogsBet(st.round, draft); onSetBalance(r.balance); setDraft({}); setMsg('Bets placed — good luck!'); refresh(); } catch (e: any) { setMsg(e?.message || 'Error'); }
  };
  const horses = st?.runners ?? [];
  const pct = st ? Math.min(1, left / (st.phase === 'betting' ? st.betMs : st.cycleMs - st.betMs)) : 0;

  return (
    <div className="max-w-3xl mx-auto p-3 sm:p-6 text-white">
      {burst > 0 && <CoinBurst key={burst} />}
      {bigWin && <BigWin tier={bigWin.tier} amount={bigWin.amount} format={(v) => `${v.toFixed(2)} L`} onDone={() => setBigWin(null)} />}
      <div className="flex items-center justify-between mb-3">
        <button onClick={onClose} className="text-sm text-gray-300 hover:text-white">← Casino</button>
        <div className="font-extrabold text-xl text-brand-yellow tracking-wide flex items-center gap-2"><span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />LIVE DOG RACE</div>
        <button onClick={() => { setSound(!snd); setSnd(!snd); }} className="text-sm px-2 py-1 rounded bg-white/10">{snd ? '🔊' : '🔇'}</button>
      </div>
      <div className="flex items-center justify-between text-xs text-emerald-100/80 mb-1">
        <span>Race #{st?.round ?? '…'}{st?.simulatedPlayers && st.tablePlayers ? ` · ${st.tablePlayers} players at the table` : ''}</span>
        <span className="font-bold tabular-nums">{betting ? `Bets close in ${Math.ceil(left / 1000)}s` : racing ? 'Race in progress' : 'Next race soon'}</span>
      </div>
      <div className="h-1.5 rounded-full bg-black/40 overflow-hidden mb-2"><div className={`h-full ${betting ? 'bg-yellow-300' : 'bg-red-500'}`} style={{ width: `${pct * 100}%`, transition: 'width .2s linear' }} /></div>

      <DogTrack dogs={horses} progress={progress} running={racing} finishOrder={finished} />
      <div className="flex gap-1 justify-center my-2 min-h-[22px]">{(st?.winners ?? []).map((w, i) => <span key={i} className="w-5 h-5 rounded-md text-[10px] font-black flex items-center justify-center text-black" style={{ background: horses[w]?.color }}>{(horses[w]?.trap ?? w + 1)}</span>)}</div>
      <div className="text-center font-bold min-h-[26px]">{winAmt > 0 ? <span className="text-brand-yellow win-pop inline-block text-lg">You won <CountUp value={winAmt} format={(v) => `${v.toFixed(2)} L`} /></span> : msg}</div>

      <div className="grid grid-cols-2 gap-1 mt-2 p-1 rounded-xl bg-black/40 border border-white/10">
        {([['win', 'Winner'], ['fc', 'Forecast 1st–2nd']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`py-1.5 rounded-lg text-sm font-black ${tab === k ? 'bg-yellow-300 text-black' : 'text-gray-300'}`}>{label}</button>
        ))}
      </div>
      {tab === 'fc' && st?.forecast && (
        <div className="mt-2 rounded-xl border border-white/10 bg-black/40 p-1.5 overflow-x-auto">
          <div className="grid gap-[3px] min-w-[300px]" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
            <div className="text-[9px] font-black text-gray-400 flex items-end justify-center leading-tight text-center">1st ↓<br />2nd →</div>
            {horses.map((h) => <div key={'c' + h.id} className="rounded h-7 flex items-center justify-center text-sm font-black" style={{ background: h.color, color: h.color === '#f1f5f9' || h.color === '#eab308' ? '#111' : '#fff' }}>{h.trap}</div>)}
            {horses.map((a) => (
              <React.Fragment key={'r' + a.id}>
                <div className="rounded h-9 flex items-center justify-center text-sm font-black" style={{ background: a.color, color: a.color === '#f1f5f9' || a.color === '#eab308' ? '#111' : '#fff' }}>{a.trap}</div>
                {horses.map((b) => {
                  if (a.id === b.id) return <div key={b.id} className="rounded h-9 bg-white/5" />;
                  const k = `F${a.id}-${b.id}`; const on = (st.myBets[k] || 0) + (draft[k] || 0);
                  return (
                    <button key={b.id} disabled={!betting} onClick={() => add(k)} className={`relative rounded h-9 text-[11px] sm:text-xs font-black tabular-nums border ${on ? 'border-yellow-300 bg-yellow-300/20 text-yellow-200' : 'border-white/10 bg-white/90 text-gray-900 hover:bg-yellow-100'} disabled:opacity-70`}>
                      {(st.forecast![a.id][b.id] ?? 0).toFixed(1)}
                      {on > 0 && <span className={`absolute -top-1 -right-0.5 min-w-[16px] px-0.5 rounded-full text-[9px] font-black text-black ${draft[k] ? 'bg-yellow-300' : 'bg-green-400'}`}>{on}</span>}
                    </button>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
          <div className="text-[10px] text-gray-400 text-center mt-1">Pick the exact 1st and 2nd dog · pays the odds in the box</div>
        </div>
      )}
      <div className={`grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2 ${tab === 'fc' ? 'hidden' : ''}`}>
        {horses.map((h) => {
          const on = (st?.myBets[h.id] || 0) + (draft[h.id] || 0);
          return (
            <button key={h.id} disabled={!betting} onClick={() => add(h.id)} className={`relative rounded-xl p-2 text-left border-2 transition ${on ? 'border-yellow-300 bg-yellow-300/10' : 'border-white/10 bg-black/40 hover:bg-black/60'} disabled:opacity-70`}>
              <div className="flex items-center gap-2"><span className="w-5 h-5 rounded-full text-[11px] font-black flex items-center justify-center text-black" style={{ background: h.color, color: h.color === '#f1f5f9' || h.color === '#eab308' ? '#111' : '#fff' }}>{h.trap}</span><span className="text-sm font-bold truncate">{h.name}</span></div>
              <div className="text-lg font-black text-brand-yellow tabular-nums mt-0.5">{h.odds.toFixed(2)}x</div>
              {on > 0 && <span className={`absolute -top-1 -right-1 min-w-[20px] px-1 rounded-full text-[10px] font-black text-black ${draft[h.id] ? 'bg-yellow-300' : 'bg-green-400'}`}>{on}</span>}
            </button>
          );
        })}
      </div>
      <div className="mt-3"><StakeInput value={chip} onChange={setChip} min={1} max={5000} presets={[10, 50, 100, 500, 1000]} unit="L" balance={userBalance} disabled={!betting} /></div>
      <div className="flex gap-2 mt-2">
        <button disabled={!betting || draftTotal === 0} onClick={() => setDraft({})} className="px-4 rounded-xl border border-white/20 text-gray-200 disabled:opacity-40">Clear</button>
        <button onClick={place} disabled={!betting || draftTotal === 0 || draftTotal > userBalance} className="flex-1 py-3.5 rounded-xl font-black text-lg bg-gradient-to-b from-green-400 to-green-700 text-white shadow-lg disabled:opacity-50">{draftTotal ? `PLACE BETS · ${draftTotal.toFixed(2)} L` : tab === 'fc' ? 'TAP A COMBINATION TO BET' : 'TAP A HORSE TO BET'}</button>
      </div>
      <div className="text-[11px] text-gray-400 mt-2 text-center">Balance: <b className="tabular-nums text-white">{userBalance.toFixed(2)} L</b> · RTP 95% · max 5000 L per race · credit only{st?.simulatedPlayers ? ' · table includes simulated players' : ''}</div>
    </div>
  );
};
export default LiveDogs;
