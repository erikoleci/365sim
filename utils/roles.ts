import { UserRole } from '../types';

/** ADMIN (the owner) and SUPER_ADMIN both get the owner dashboard. */
export const isAdminRole = (role: UserRole | string | undefined | null): boolean =>
  role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN;

export const isSuperAdminRole = (role: UserRole | string | undefined | null): boolean => role === UserRole.SUPER_ADMIN;
