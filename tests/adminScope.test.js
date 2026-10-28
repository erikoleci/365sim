import { describe, it, expect } from 'vitest';
import { scopeOf, ownsRow } from '../server/adminScope.js';

describe('scopeOf', () => {
  it('has no restriction for the super admin', () => {
    expect(scopeOf({ id: 's1', role: 'SUPER_ADMIN' })).toBeNull();
  });
  it('restricts a normal admin to his own id', () => {
    expect(scopeOf({ id: 'a1', role: 'ADMIN' })).toBe('a1');
  });
  it('never widens the scope when the account has no id', () => {
    expect(scopeOf({ role: 'ADMIN' })).not.toBeNull();
  });
});

describe('ownsRow', () => {
  const admin1 = { id: 'a1', role: 'ADMIN' };
  const superAdmin = { id: 's1', role: 'SUPER_ADMIN' };
  it('lets an admin manage his own agent', () => {
    expect(ownsRow(admin1, { id: 'ag1', admin_id: 'a1' })).toBe(true);
  });
  it("blocks an admin from another admin's agent", () => {
    expect(ownsRow(admin1, { id: 'ag2', admin_id: 'a2' })).toBe(false);
  });
  it('blocks an admin from unowned rows', () => {
    expect(ownsRow(admin1, { id: 'ag3', admin_id: null })).toBe(false);
  });
  it('lets the super admin manage everything', () => {
    expect(ownsRow(superAdmin, { id: 'ag2', admin_id: 'a2' })).toBe(true);
    expect(ownsRow(superAdmin, { id: 'ag3', admin_id: null })).toBe(true);
  });
  it('refuses a missing row', () => {
    expect(ownsRow(admin1, undefined)).toBe(false);
  });
});
