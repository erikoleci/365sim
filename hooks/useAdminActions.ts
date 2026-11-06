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

export type NewUser = { name: string; username: string; password: string; balance: number; balanceEur?: number; currency?: 'ALL' | 'EUR' | 'BOTH'; role: 'USER' | 'AGENT' | 'ADMIN' };

/** Everything the owner (ADMIN) does: users, credit, tickets, manual settlement. */
export function useAdminActions({ currentUser, setCurrentUser, panelOpen, reloadMatches }: Options) {
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

  // The big lists (up to 1000 users and 500 tickets with their legs) are only needed in the management tab. They used to
  // be downloaded at the very moment the dashboard opened, competing with the overview the person is looking at. Now the
  // overview goes first and these follow a moment later (at once when the panel overlay itself was opened).
  useEffect(() => {
    if (panelOpen) { loadAdminData(); return; }
    if (!isAdmin) return;
    const timer = setTimeout(loadAdminData, 1200);
    return () => clearTimeout(timer);
  }, [panelOpen, isAdmin, loadAdminData]);

  // Live refresh: tickets change all the time (new bets, settlements, early closes), so while the admin screen is
  // open the lists reload on their own every few seconds. Skipped while the browser tab is hidden and while the
  // previous reload is still running, so a slow connection never piles requests up.
  useEffect(() => {
    if (!isAdmin) return;
    let busy = false;
    const tick = async () => {
      if (busy || document.visibilityState !== 'visible') return;
      busy = true;
      try { await loadAdminData(); } finally { busy = false; }
    };
    const timer = window.setInterval(tick, 10000);
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [isAdmin, loadAdminData]);

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

  const addCredit = async (userId: string, amount: number, amountEur = 0) => {
    try {
      // credit for an admin account is the super admin's own route (ledger SUPER_TO_ADMIN)
      if (isSuper && adminUsers.find((u) => u.id === userId)?.role === UserRole.ADMIN) {
        if (amount < 0 || amountEur < 0) await api.adminDebitAdmin(userId, Math.abs(amount), Math.abs(amountEur)); else await api.adminCreditAdmin(userId, amount, amountEur);
      }
      else await api.adminAddCredit(userId, amount, amountEur);
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

  // Admin / super admin: close a ticket as won or lost.
  const resolveBet = useCallback(async (betId: string, outcome: 'WON' | 'LOST', currentStatus?: string) => {
    const msg = outcome === 'WON'
      ? t('Ta bëj këtë biletë FITUESE dhe t\'ia paguaj fitimin lojtarit?')
      : currentStatus === 'WON'
        ? t('Ta bëj këtë biletë HUMBËSE? Fitimi që i është paguar do t\'i merret mbrapsht.')
        : t('Ta mbyll këtë biletë si HUMBËSE?');
    if (!window.confirm(msg)) return;
    try {
      await api.adminResolveBet(betId, outcome);
      await loadAdminData();
    } catch (e: any) {
      alert(e.message || t('Veprimi deshtoi'));
    }
  }, [loadAdminData, t]);

  // Emergency only: set ONE match of a ticket as won or lost (the system normally does it when the match ends).
  const resolveLeg = useCallback(async (legId: number, outcome: 'WON' | 'LOST') => {
    try {
      await api.adminSetLeg(legId, outcome);
      await loadAdminData();
    } catch (e: any) {
      alert(e.message || t('Veprimi deshtoi'));
    }
  }, [loadAdminData, t]);

  const setAccountCurrency = useCallback(async (userId: string, currency: 'ALL' | 'EUR' | 'BOTH') => {
    try {
      await api.adminSetAccountCurrency(userId, currency);
      await loadAdminData();
    } catch (e: any) {
      alert(e.message || t('Veprimi deshtoi'));
    }
  }, [loadAdminData, t]);

  const cancelBet = useCallback(async (betId: string, origin: 'USER' | 'ADMIN') => {
    if (origin === 'ADMIN') {
      if (!window.confirm(t('Ta anuloj këtë biletë dhe t\'i kthej paratë? Bileta hiqet nga lista.'))) return;
      try {
        // Cancel = refund + the ticket disappears from the list
        await api.adminCancelBet(betId);
        await loadAdminData();
      } catch (e: any) {
        alert(e.message || 'Failed to cancel bet');
      }
      return;
    }
  }, [loadAdminData, t]);

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

  return { adminUsers, adminAllBets, simulatingMatchId, createUser, deleteUser, addCredit, resetPassword, cancelBet, resolveBet, resolveLeg, setAccountCurrency, settleMatch, reset };
}
