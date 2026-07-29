// server/providers/registry.js
//
// Single place where all odds provider adapters are registered.
// - getActiveProvider(): the PRIMARY match source (drives the matches list).
// - getEnrichmentProviders(): secondary sources that top up bookmaker odds
//   or push live scores onto matches already cached by the primary source.
// Adding a new primary provider = write one adapter + register() it +
// flip ODDS_PROVIDER env var. Adding a new enrichment source = same,
// just push it into ALL_ENRICHMENT_ADAPTERS instead.

import { TheOddsApiAdapter } from './TheOddsApiAdapter.js';
import { ALL_ENRICHMENT_ADAPTERS } from './EnrichmentAdapters.js';

const providers = new Map();

function register(adapter) {
  providers.set(adapter.name, adapter);
}

register(new TheOddsApiAdapter());
ALL_ENRICHMENT_ADAPTERS.forEach(register);

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

export function getEnrichmentProviders() {
  return ALL_ENRICHMENT_ADAPTERS;
}

export function listRegisteredProviders() {
  return [...providers.keys()];
}
