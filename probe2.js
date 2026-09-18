// Temporary probe #2: collect the FULL set of attribute names the provider's
// gamedetails socket sends, plus a few verbatim card/event samples.
import io from 'socket.io-client';
import https from 'https';

function api(path) {
  return new Promise((resolve, reject) => {
    https.get({ host: 'eccoplay365.com', path: '/ajax' + path, headers: {
      Origin: 'https://londonpro365.com', Referer: 'https://londonpro365.com/',
      'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; });
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

const keyCount = {};
const values = {};
const gdSamples = [];
const coefSamples = [];
const otherEvents = {};

(async () => {
  const games = await api('/livegames');
  const soccer = games.filter((g) => Number(g.sport_id) === 1).slice(0, 8);
  const sock = io('https://ecco-p2p.socketi355.com:1338', {
    transports: ['websocket'], rejectUnauthorized: false, reconnection: false,
  });
  sock.onAny((ev, ...args) => {
    otherEvents[ev] = (otherEvents[ev] || 0) + 1;
    if (ev !== 'gamedetails' && coefSamples.length < 6) {
      coefSamples.push(ev + ' :: ' + JSON.stringify(args).slice(0, 220));
    }
  });
  sock.on('connect', () => {
    for (const g of soccer) sock.emit('merranimim', { gameid: String(g.id) });
  });
  sock.on('gamedetails', (raw) => {
    const s = String(raw || '');
    const re = /([A-Za-z0-9_]+)\s*=\s*"([^"]*)"/g;
    let m;
    const local = {};
    while ((m = re.exec(s))) {
      keyCount[m[1]] = (keyCount[m[1]] || 0) + 1;
      local[m[1]] = m[2];
      (values[m[1]] = values[m[1]] || new Set()).add(m[2]);
    }
    if (gdSamples.length < 3) gdSamples.push(local);
  });
  setTimeout(() => {
    console.log('ATTR_KEYS', JSON.stringify(keyCount));
    const compact = {};
    for (const k of Object.keys(values)) {
      const arr = [...values[k]];
      compact[k] = arr.length > 6 ? arr.slice(0, 6).concat(['...' + arr.length + ' distinct']) : arr;
    }
    console.log('ATTR_VALUES', JSON.stringify(compact).slice(0, 3000));
    console.log('OTHER_EVENTS', JSON.stringify(otherEvents));
    console.log('SAMPLES', JSON.stringify(coefSamples).slice(0, 1200));
    console.log('GD_SAMPLES', JSON.stringify(gdSamples).slice(0, 1500));
    sock.close(); process.exit(0);
  }, 40000);
})();