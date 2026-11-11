// DEV ONLY (not part of the build): renders the casino lobby on its own so it can be looked at in a browser.
import React from 'react';
import ReactDOM from 'react-dom/client';
import '../index.css';
import CasinoHub from '../components/CasinoHub';

const App = () => {
  const [bal, setBal] = React.useState(12480.5);
  return <CasinoHub userBalance={bal} userBalanceEur={0} accountCurrency="ALL" onSetBalance={(b) => setBal(b)} showAllGames />;
};
ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
