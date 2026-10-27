import { isAdminRole, isSuperAdminRole } from '../utils/roles';
import { useCallback, useEffect, useState } from 'react';
import { Match, User, UserRole } from '../types';
import * as api from '../services/api';
import { useI18n } from '../i18n';

interface Options {
  currentUser: User | null;
  setCurrentUser: (user: User | null) => void;
  /** True while the agent/admin panel overlay is open (loads the data even for non-admins). */
  panelOpen: boolean;
  /** Reload the match list after a manual settlement. */
  reloadMatches: () => Promise<void> | void;
  /** Reload the signed-in user's own tickets after cancelling one. */
  reloadMyBets: () => Promise<void> | void;
  applyBalance: (balance: number) => void;
}

export type NewUser = { name: string; username: string; password: string; balance: number; role: 'USER' | 'AGENT' | 'ADMIN' };

/** Everything the owner (ADMIN) does: users, credit, tickets, manual settlement. */
export function useAdminActions({ currentUser, setCurrentUser, panelOpen, reloadMatches, reloadMyBets, applyBalance }: Options) {
  const { t } = useI18n();
  const [adminUsers, setAdminUsers] = useState<User[]>([]);
  const [adminAllBets, setAdminAllBets] = useState<any[]>([]);
  const [simulatingMatchId, setSimulatingMatchId] = useState<string | null>(null);
  const isAdmin = isAdminRole(currentUser?.role);
  const isSuper = isSuperAdminRole(currentUser?.role);

  const loadAdminData = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const [users, bets] = await Promise.all([api.adminFetchUsers(), api.adminFetchAllBets()]);
      setAdminUsers(users);
      setAdminAllBets(bets);
    } catch (e) {
      console.error('Failed to load admin data', e);
    }
  }, [isAdmin]);

  // The owner's data loads as soon as they sign in, so their dashboard has it immediately.
  useEffect(() => { if (panelOpen || isAdmin) loadAdminData(); }, [panelOpen, isAdmin, loadAdminData]);

  // The admin picks the role at creation: USER and AGENT are separate tables/permissions server-side.
  const createUser = async (newUser: NewUser) => {
    try {
      const { role, ...rest } = newUser;
      if (role === 'AGENT') await api.adminCreateAgent(rest);
      else if (role === 'ADMIN' && isSuper) await api.adminCreateAdmin(rest);
      else await api.adminCreateUser(rest);
      await loadAdminData();
    } catch (e: any) {
      alert(e.message || 'Failed to create user');
    }
  };

  // Safe delete first (refused with USER_HAS_HISTORY when the user has bets/transactions/rounds).
  // Only on that refusal is a force-delete offered, confirmed explicitly: it is irreversible.
  const deleteUser = async (userId: string) => {
    try {
      await api.adminDeleteUser(userId);
      await loadAdminData();
    } catch (e: any) {
      if (e?.code !== 'USER_HAS_HISTORY') { alert(e.message || 'Failed to delete user'); return; }
      const confirmed = window.confirm(
        (e.message || t('Ky user ka histori.')) +
        '\n\n' + t('A doni ta fshini PLOTËSISHT këtë user, duke përfshirë të gjitha kuponat, transaksionet dhe historikun financiar? Ky veprim s\'kthehet mbrapa.')
      );
      if (!confirmed) return;
      try {
        await api.adminForceDeleteUser(userId);
        await loadAdminData();
      } catch (e2: any) {
        alert(e2.message || 'Failed to force-delete user');
      }
    }
  };

  const addCredit = async (userId: string, amount: number) => {
    try {
      // credit for an admin account is the super admin's own route (ledger SUPER_TO_ADMIN)
      if (isSuper && adminUsers.find((u) => u.id === userId)?.role === UserRole.ADMIN) {
        if (amount < 0) await api.adminDebitAdmin(userId, -amount); else await api.adminCreditAdmin(userId, amount);
      }
      else await api.adminAddCredit(userId, amount);
      await loadAdminData();
      if (currentUser?.id === userId) setCurrentUser(await api.fetchCurrentUser());
    } catch (e: any) {
      alert(e.message || 'Failed to add credit');
    }
  };

  const resetPassword = async (userId: string, newPassword: string) => {
    try {
      await api.adminResetPassword(userId, newPassword);
      alert('Password updated');
    } catch (e: any) {
      alert(e.message || 'Failed to reset password');
    }
  };

  const cancelBet = useCallback(async (betId: string, origin: 'USER' | 'ADMIN') => {
    if (origin === 'ADMIN') {
      if (!window.confirm('Admin delete this bet and adjust balance?')) return;
      try {
        // the super admin erases any ticket (open, live or settled)
        if (isSuper) await api.adminDeleteBet(betId); else await api.adminCancelBet(betId);
        await loadAdminData();
      } catch (e: any) {
        alert(e.message || 'Failed to cancel bet');
      }
      return;
    }
    // A regular user cancelling their own still-pending ticket.
    try {
      const { balance } = await api.cancelMyBet(betId);
      applyBalance(balance);
      await reloadMyBets();
    } catch (e: any) {
      alert(e.message || t('Anulimi dështoi.'));
    }
  }, [loadAdminData, reloadMyBets, applyBalance, t]);

  const settleMatch = useCallback(async (match: Match, homeScore: number, awayScore: number) => {
    if (simulatingMatchId) return;
    setSimulatingMatchId(match.id);
    try {
      const result = await api.adminSettleMatch(match.id, homeScore, awayScore);
      if (result.leftPendingForManualReview > 0) {
        alert(
          t('{n} kupon(a) u zgjidhën automatikisht.', { n: result.autoSettledLegs }) + '\n' +
          t('{n} kupon(a) mbetën PENDING (tregje si Double Chance/Handicap kërkojnë rishikim manual te "All Tickets").', { n: result.leftPendingForManualReview })
        );
      }
      await Promise.all([reloadMatches(), loadAdminData()]);
    } catch (e: any) {
      alert(e.message || 'Failed to settle match');
    } finally {
      setSimulatingMatchId(null);
    }
  }, [simulatingMatchId, reloadMatches, loadAdminData, t]);

  const reset = useCallback(() => { setAdminUsers([]); setAdminAllBets([]); }, []);

  return { adminUsers, adminAllBets, simulatingMatchId, createUser, deleteUser, addCredit, resetPassword, cancelBet, settleMatch, reset };
}
