// Account roles. SUPER_ADMIN is above ADMIN (the owner): everything an ADMIN can do, plus giving
// credit to admins, creating / deleting admins and erasing any ticket.
export const ROLE_SUPER_ADMIN = 'SUPER_ADMIN';
export const ROLE_ADMIN = 'ADMIN';
export const isAdminRole = (role) => role === ROLE_ADMIN || role === ROLE_SUPER_ADMIN;
export const isSuperAdmin = (role) => role === ROLE_SUPER_ADMIN;
