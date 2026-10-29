// Casino is switched off while the games are being rebuilt.
// To turn it back on: set VITE_CASINO_ENABLED=true at build time AND CASINO_ENABLED=true on the server.
export const CASINO_ENABLED = (import.meta as any).env?.VITE_CASINO_ENABLED === 'true';
