// DEV ONLY (not part of the build): the live pitch in every action state.
import React from 'react';
import ReactDOM from 'react-dom/client';
import '../index.css';
import LivePitch from '../components/LivePitch';
import { MatchStatus } from '../types';

const base: any = { id: 'x', homeTeam: 'Khonkaen Mordindang FC', awayTeam: 'Korat City FC', league: 'Thailand Division 3', status: MatchStatus.LIVE, liveHomeScore: 2, liveAwayScore: 0, liveMinute: '67' };
const kinds: Array<[string, string | null, 'home' | 'away' | null]> = [
  ['Pa veprim', null, null], ['attack', 'Sulm', 'home'], ['dangerous_attack', 'Sulm i rrezikshëm', 'away'], ['corner', 'Korne', 'home'],
  ['free_kick', 'Gjuajtje e lirë', 'away'], ['penalty', 'Penallti', 'home'], ['big_chance', 'Shanc i madh për gol', 'away'], ['goal', 'Gol', 'home'],
];
const App = () => (
  <div style={{ padding: 8, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,420px),1fr))' }}>
    {kinds.map(([k, label, side]) => (
      <div key={k}><div style={{ color: '#aaa', font: '11px sans-serif' }}>{k} {side}</div>
        <LivePitch match={{ ...base, liveAction: label ? { kind: k, label, side } : null }} stats={{ possession_home: 58, possession_away: 42 } as any} />
      </div>
    ))}
  </div>
);
ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
