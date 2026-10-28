// Ownership between admins. Every agent and every user carries `admin_id`: the admin who owns him.
// A normal admin only ever sees / touches rows with admin_id = his own id; the super admin sees everything.
import { isSuperAdmin } from './roles.js';

// SQL parameter for "rows I may see": null = no restriction (super admin), otherwise the admin's id.
// A non-super account without an id gets a value no row can have, so a bug can never widen the scope.
export function scopeOf(user) {
  if (isSuperAdmin(user?.role)) return null;
  return user?.id ?? '__no_scope__';
}

// May this actor manage this row (a users row, read with its admin_id column)?
export function ownsRow(user, row) {
  if (!row) return false;
  if (isSuperAdmin(user?.role)) return true;
  return Boolean(user?.id) && row.admin_id === user.id;
}
