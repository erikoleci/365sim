// DEV ONLY: national team rows with the flag stand-in.
import React from 'react';
import ReactDOM from 'react-dom/client';
import '../index.css';
import TeamLogo from '../components/TeamLogo';
const names = ['Armenia', 'Cyprus', 'Turkiye', 'Belgium', 'Italy', 'France', 'England', 'Croatia', 'Czechia', 'Spain', 'Albania', 'Arsenal'];
ReactDOM.createRoot(document.getElementById('root')!).render(
  <div style={{ padding: 12, display: 'grid', gap: 8, color: '#fff', font: '16px sans-serif' }}>
    {names.map((n) => <div key={n} style={{ display: 'flex', gap: 10, alignItems: 'center' }}><TeamLogo name={n} size="md" /> {n}</div>)}
  </div>
);
