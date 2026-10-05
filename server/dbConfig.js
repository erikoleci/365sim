// Connection settings for PostgreSQL (kept free of any `pg` import so it can be
// unit-tested without a database or mocks).
//
// WHY THIS EXISTS -- SELF_SIGNED_CERT_IN_CHAIN with Aiven
// node-postgres lets the connection string OVERRIDE the `ssl` option given in
// code. A DATABASE_URL ending in `?sslmode=require` makes pg 8.x use full
// certificate verification (`ssl: {}`) and silently drops the
// `ssl: { rejectUnauthorized: false }` that used to sit next to it. Aiven signs
// its server certificates with a project-private CA that Node does not know, so
// the handshake fails with SELF_SIGNED_CERT_IN_CHAIN.
//
// The fix is NOT to switch verification off (and never NODE_TLS_REJECT_UNAUTHORIZED=0).
// It is to teach Node the CA: download "CA certificate" from the Aiven service
// page and give it to the app through ONE of
//   DATABASE_CA_CERT       the PEM text itself (literal "\n" sequences are accepted)
//   DATABASE_CA_CERT_FILE  path to the ca.pem file
//   ?sslrootcert=/path     the libpq way, inside DATABASE_URL
// With a CA the connection is fully verified (chain + host name).
//
// SSL parameters are stripped from the URL and re-applied here as an explicit
// `ssl` object, so what is configured is exactly what pg uses.
//
// sslmode semantics (libpq):
//   disable                  no TLS
//   prefer / require / (none) TLS; certificate verified only when a CA is supplied
//   no-verify                TLS, never verified (explicit opt-out)
//   verify-ca / verify-full  TLS, always verified (CA if supplied, else Node's trust store)

import fs from 'node:fs';

const STRIPPED_QUERY_KEYS = ['sslmode', 'ssl', 'uselibpqcompat', 'sslrootcert'];

// Removes the ssl-related query parameters from a connection string and
// returns them separately. Everything else (options=, application_name=, ...)
// is left exactly as given.
export function splitSslFromUrl(raw) {
  const text = String(raw || '').trim();
  const qIdx = text.indexOf('?');
  if (qIdx === -1) return { url: text, sslmode: null, sslrootcert: null };
  const base = text.slice(0, qIdx);
  const params = new URLSearchParams(text.slice(qIdx + 1));
  const sslmode = params.get('sslmode');
  const sslrootcert = params.get('sslrootcert');
  for (const key of STRIPPED_QUERY_KEYS) params.delete(key);
  const rest = params.toString();
  return { url: rest ? base + '?' + rest : base, sslmode, sslrootcert };
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^\[|\]$/g, '');
  } catch {
    const m = /@([^:/?#]+)/.exec(url) || /\/\/([^:/?#@]+)/.exec(url);
    return m ? m[1] : '';
  }
}

export function isLocalHost(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

// PEM supplied through an environment variable: accept real newlines, literal
// "\n" sequences (common in .env files / dashboards) and surrounding quotes.
export function normalizePem(value) {
  let pem = String(value || '').trim();
  if ((pem.startsWith('"') && pem.endsWith('"')) || (pem.startsWith("'") && pem.endsWith("'"))) {
    pem = pem.slice(1, -1);
  }
  return pem.replace(/\\n/g, '\n').trim();
}

function loadCa(env, sslrootcert, readFile) {
  const inline = env.DATABASE_CA_CERT;
  if (inline && String(inline).trim()) {
    const ca = normalizePem(inline);
    if (!ca.includes('BEGIN CERTIFICATE')) {
      throw new Error('[db] DATABASE_CA_CERT is set but does not look like a PEM certificate (no "BEGIN CERTIFICATE").');
    }
    return { ca, source: 'DATABASE_CA_CERT' };
  }
  const file = env.DATABASE_CA_CERT_FILE || sslrootcert;
  if (file) {
    let ca;
    try {
      ca = readFile(file);
    } catch (err) {
      throw new Error('[db] cannot read the CA certificate file "' + file + '": ' + err.message);
    }
    if (!String(ca).includes('BEGIN CERTIFICATE')) {
      throw new Error('[db] "' + file + '" does not look like a PEM certificate (no "BEGIN CERTIFICATE").');
    }
    return { ca, source: env.DATABASE_CA_CERT_FILE ? 'DATABASE_CA_CERT_FILE' : 'sslrootcert' };
  }
  return null;
}

// Returns { connectionString, ssl, description, verified, warning }.
// Throws only for an unusable CA setting -- a configuration mistake that must
// be loud, not silently downgraded to an unverified connection.
export function resolveDbConnection(env = process.env, readFile = (p) => fs.readFileSync(p, 'utf8')) {
  const raw = env.DATABASE_URL;
  if (!raw) {
    return {
      connectionString: undefined,
      ssl: { rejectUnauthorized: false },
      description: 'DATABASE_URL not set',
      verified: false,
      warning: null,
    };
  }

  const { url, sslmode, sslrootcert } = splitSslFromUrl(raw);
  const mode = String(sslmode || '').toLowerCase();
  const host = hostOf(url);

  if (isLocalHost(host) || mode === 'disable') {
    return {
      connectionString: url,
      ssl: false,
      description: 'TLS off (' + (mode === 'disable' ? 'sslmode=disable' : 'local database') + ')',
      verified: false,
      warning: null,
    };
  }

  if (mode === 'no-verify') {
    return {
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      description: 'TLS on, certificate NOT verified (sslmode=no-verify)',
      verified: false,
      warning: null,
    };
  }

  const found = loadCa(env, sslrootcert, readFile);
  if (found) {
    return {
      connectionString: url,
      ssl: { ca: found.ca, rejectUnauthorized: true },
      description: 'TLS on, certificate verified with the CA from ' + found.source,
      verified: true,
      warning: null,
    };
  }

  if (mode === 'verify-ca' || mode === 'verify-full') {
    return {
      connectionString: url,
      ssl: { rejectUnauthorized: true },
      description: 'TLS on, certificate verified with the system trust store (sslmode=' + mode + ')',
      verified: true,
      warning: /aivencloud\.com$/i.test(host)
        ? 'Aiven uses its own CA: set DATABASE_CA_CERT or DATABASE_CA_CERT_FILE, otherwise the handshake fails with SELF_SIGNED_CERT_IN_CHAIN.'
        : null,
    };
  }

  // prefer / require / no sslmode, and no CA supplied: encrypted but unverified.
  // This is what this app has always done; it is kept so a deploy without the
  // CA keeps working, but it is reported loudly.
  return {
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    description: 'TLS on, certificate NOT verified (no CA supplied)',
    verified: false,
    warning: 'The database certificate is not being verified. Set DATABASE_CA_CERT or DATABASE_CA_CERT_FILE (Aiven: service page -> "CA certificate") to enable full verification.',
  };
}
