// server/providers/registry.js
//
// Single place where all odds provider adapters are registered. The rest
// of the app calls getActiveProvider() / getProvider(name) instead of
// importing a specific provider directly — this is what makes "add a new
// odds API" a one-file change instead of a codebase-wide refactor.

import { TheOddsApiAdapter } from './TheOddsApiAdapter.js';

const providers = new Map();

function register(adapter) {
  providers.set(adapter.name, adapter);
}

register(new TheOddsApiAdapter());

// Example for the future — uncomment and implement when ready:
// import { SportradarAdapter } from './SportradarAdapter.js';
// register(new SportradarAdapter());
// import { ApiFootballAdapter } from './ApiFootballAdapter.js';
// register(new ApiFootballAdapter());

const ACTIVE_PROVIDER = process.env.ODDS_PROVIDER || 'the-odds-api';

export function getProvider(name) {
  const p = providers.get(name);
  if (!p) throw new Error(`Unknown odds provider "${name}". Registered: ${[...providers.keys()].join(', ')}`);
  return p;
}

export function getActiveProvider() {
  return getProvider(ACTIVE_PROVIDER);
}

export function listRegisteredProviders() {
  return [...providers.keys()];
}
