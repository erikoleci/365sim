import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { resolveDbConnection, splitSslFromUrl, normalizePem, isLocalHost } from '../server/dbConfig.js';

const require = createRequire(import.meta.url);
const ConnectionParameters = require('pg/lib/connection-parameters');

const AIVEN = 'postgres://avnadmin:s3cret@pg-abc.aivencloud.com:12345/defaultdb';
const PEM = '-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----';

describe('splitSslFromUrl', () => {
  it('returns the URL untouched when there is no query', () => {
    expect(splitSslFromUrl(AIVEN)).toEqual({ url: AIVEN, sslmode: null, sslrootcert: null });
  });

  it('removes sslmode / ssl / uselibpqcompat / sslrootcert and keeps every other parameter', () => {
    const r = splitSslFromUrl(AIVEN + '?sslmode=require&application_name=365sim&uselibpqcompat=true&sslrootcert=/tmp/ca.pem');
    expect(r.url).toBe(AIVEN + '?application_name=365sim');
    expect(r.sslmode).toBe('require');
    expect(r.sslrootcert).toBe('/tmp/ca.pem');
  });

  it('leaves no dangling "?" when sslmode was the only parameter', () => {
    expect(splitSslFromUrl(AIVEN + '?sslmode=require').url).toBe(AIVEN);
  });
});

describe('normalizePem', () => {
  it('turns literal \\n sequences and quotes into a real PEM', () => {
    expect(normalizePem('"-----BEGIN CERTIFICATE-----\\nMIIB\\n-----END CERTIFICATE-----"'))
      .toBe('-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----');
  });
});

describe('resolveDbConnection', () => {
  it('sslmode=require (the Aiven default URL) no longer overrides our ssl option', () => {
    const r = resolveDbConnection({ DATABASE_URL: AIVEN + '?sslmode=require' });
    expect(r.connectionString).toBe(AIVEN);
    expect(r.ssl).toEqual({ rejectUnauthorized: false });
    expect(r.verified).toBe(false);
    expect(r.warning).toMatch(/DATABASE_CA_CERT/);
    // What pg will really use is exactly our object (the URL cannot change it any more).
    const p = new ConnectionParameters({ connectionString: r.connectionString, ssl: r.ssl });
    expect(p.ssl).toEqual({ rejectUnauthorized: false });
  });

  it('with a CA from DATABASE_CA_CERT the connection is fully verified', () => {
    const r = resolveDbConnection({ DATABASE_URL: AIVEN + '?sslmode=require', DATABASE_CA_CERT: PEM });
    expect(r.ssl).toEqual({ ca: PEM, rejectUnauthorized: true });
    expect(r.verified).toBe(true);
    expect(r.warning).toBeNull();
    const p = new ConnectionParameters({ connectionString: r.connectionString, ssl: r.ssl });
    expect(p.ssl.rejectUnauthorized).toBe(true);
    expect(p.ssl.ca).toBe(PEM);
  });

  it('accepts a CA with literal \\n sequences (single-line env var)', () => {
    const r = resolveDbConnection({ DATABASE_URL: AIVEN, DATABASE_CA_CERT: PEM.replace(/\n/g, '\\n') });
    expect(r.ssl.ca).toBe(PEM);
  });

  it('reads the CA from DATABASE_CA_CERT_FILE', () => {
    const seen = [];
    const r = resolveDbConnection({ DATABASE_URL: AIVEN, DATABASE_CA_CERT_FILE: 'C:\\certs\\ca.pem' }, (p) => { seen.push(p); return PEM; });
    expect(seen).toEqual(['C:\\certs\\ca.pem']);
    expect(r.ssl).toEqual({ ca: PEM, rejectUnauthorized: true });
    expect(r.description).toMatch(/DATABASE_CA_CERT_FILE/);
  });

  it('reads the CA from sslrootcert inside the URL (libpq style)', () => {
    const r = resolveDbConnection({ DATABASE_URL: AIVEN + '?sslmode=verify-full&sslrootcert=/etc/ca.pem' }, () => PEM);
    expect(r.ssl).toEqual({ ca: PEM, rejectUnauthorized: true });
    expect(r.connectionString).toBe(AIVEN);
  });

  it('verify-full without a CA verifies against the system store and explains the Aiven case', () => {
    const r = resolveDbConnection({ DATABASE_URL: AIVEN + '?sslmode=verify-full' });
    expect(r.ssl).toEqual({ rejectUnauthorized: true });
    expect(r.warning).toMatch(/SELF_SIGNED_CERT_IN_CHAIN/);
  });

  it('no sslmode and no CA keeps the previous behaviour (encrypted, unverified) but warns', () => {
    const r = resolveDbConnection({ DATABASE_URL: AIVEN });
    expect(r.ssl).toEqual({ rejectUnauthorized: false });
    expect(r.warning).not.toBeNull();
  });

  it('sslmode=no-verify is an explicit opt-out without a warning', () => {
    const r = resolveDbConnection({ DATABASE_URL: AIVEN + '?sslmode=no-verify' });
    expect(r.ssl).toEqual({ rejectUnauthorized: false });
    expect(r.warning).toBeNull();
  });

  it('local databases and sslmode=disable use no TLS', () => {
    expect(resolveDbConnection({ DATABASE_URL: 'postgresql://t:t@localhost:5432/test' }).ssl).toBe(false);
    expect(resolveDbConnection({ DATABASE_URL: 'postgresql://t:t@127.0.0.1:5432/test' }).ssl).toBe(false);
    expect(resolveDbConnection({ DATABASE_URL: AIVEN + '?sslmode=disable' }).ssl).toBe(false);
  });

  it('does not treat a remote host as local just because the word appears elsewhere in the URL', () => {
    const r = resolveDbConnection({ DATABASE_URL: 'postgres://u:localhost@pg-abc.aivencloud.com:12345/db' });
    expect(r.ssl).not.toBe(false);
  });

  it('a CA setting that is not a PEM fails loudly instead of silently downgrading', () => {
    expect(() => resolveDbConnection({ DATABASE_URL: AIVEN, DATABASE_CA_CERT: 'not a certificate' })).toThrow(/PEM/);
    expect(() => resolveDbConnection({ DATABASE_URL: AIVEN, DATABASE_CA_CERT_FILE: '/nope.pem' }, () => { throw new Error('ENOENT'); })).toThrow(/cannot read/);
  });

  it('isLocalHost', () => {
    expect(isLocalHost('localhost')).toBe(true);
    expect(isLocalHost('pg.aivencloud.com')).toBe(false);
  });
});
