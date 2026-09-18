// Temporary probe: confirm the LondonPro365 "gamedetails" socket really pushes
// live per-match deltas (score/cards/minute) for a subscribed game.
import io from 'socket.io-client';
import https from 'https';

function api(path) {
  return new Promise((resolve, reject) => {
    https.get({
      host: 'eccoplay365.com',
      path: '/ajax' + path,
      headers: {
        Origin: 'https://londonpro365.com',
        Referer: 'https://londonpro365.com/',
        'User-Agent': 'Mozilla/5.0',
        Accept: 'application/json',
      },
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

(async () => {
  const games = await api('/livegames');
  const soccer = games.filter((g) => Number(g.sport_id) === 1).slice(0, 5);
  console.log('LIVE_SOCCER_COUNT', games.filter((g) => Number(g.sport_id) === 1).length);

  const sock = io('https://ecco-p2p.socketi355.com:1338', {
    transports: ['websocket'],
    rejectUnauthorized: false,
    reconnection: false,
  });

  let n = 0;
  sock.on('connect', () => {
    console.log('SOCKET_CONNECTED');
    for (const g of soccer) {
      sock.emit('merranimim', { gameid: String(g.id) });
      console.log('SUBSCRIBED', g.id, g.home_team, '-', g.away_team, g.result, g.current_minute);
    }
  });
  sock.on('gamedetails', (raw) => {
    n += 1;
    if (n <= 8) console.log('DETAIL#' + n, String(raw).slice(0, 260));
  });
  sock.on('connect_error', (e) => console.log('CONNECT_ERROR', e.message));

  setTimeout(() => {
    console.log('TOTAL_DETAIL_EVENTS', n);
    sock.close();
    process.exit(0);
  }, 35000);
})();