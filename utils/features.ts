// Casino is in the works: only the SUPER_ADMIN sees it. To open it to everybody later:
// set VITE_CASINO_ENABLED=true at build time AND CASINO_ENABLED=true on the server.
export const CASINO_ENABLED = (import.meta as any).env?.VITE_CASINO_ENABLED === 'true';

// Who gets the casino in the UI (the server enforces the same rule in server/routes/casino.js).
export const canSeeCasino = (role: string | undefined | null): boolean => role === 'SUPER_ADMIN' || CASINO_ENABLED;
