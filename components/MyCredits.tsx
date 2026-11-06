import React, { useEffect, useState } from 'react';
import * as api from '../services/api';
import { useI18n, getLocale } from '../i18n';

const money = (n: number) => Number(n || 0).toLocaleString(getLocale(), { maximumFractionDigits: 2 });
const when = (ms: number) => new Date(ms).toLocaleString(getLocale(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** An admin's own page: the credit the super admin gave him, with date and time. */
const MyCredits: React.FC = () => {
  const { t } = useI18n();
  const [data, setData] = useState<api.MyCredits | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => { api.adminFetchMyCredits().then(setData).catch(() => setError(true)); }, []);
  if (!data) return <div className="text-sm text-brand-textMuted py-10 text-center">{error ? t('Ngarkimi deshtoi.') : t('Duke ngarkuar...')}</div>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 max-w-md">
        <div className="bg-brand-panel border border-[#444] rounded p-3"><div className="text-[10px] uppercase tracking-wider text-brand-textMuted mb-1">{t('Kredi e marre (leke)')}</div><div className="font-bold">{money(data.total.ALL)} L</div></div>
        <div className="bg-brand-panel border border-[#444] rounded p-3"><div className="text-[10px] uppercase tracking-wider text-brand-textMuted mb-1">{t('Kredi e marre (euro)')}</div><div className="font-bold">€{money(data.total.EUR)}</div></div>
      </div>
      <div className="bg-brand-panel border border-[#444] rounded">
        <div className="px-3 py-2 text-xs font-bold uppercase tracking-wider border-b border-[#444]">{t('Kredia qe ke marre')}</div>
        {data.credits.length === 0 ? <div className="text-xs text-brand-textMuted p-4 text-center">{t('Asnje kredi e regjistruar.')}</div> : (
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead><tr className="text-left text-brand-textMuted"><th className="p-2">{t('Data')}</th><th className="p-2 text-right">{t('Shuma')}</th><th className="p-2"></th></tr></thead>
            <tbody>{data.credits.map((c) => (
              <tr key={c.id} className="border-t border-[#333]">
                <td className="p-2 whitespace-nowrap">{when(c.at)}</td>
                <td className="p-2 text-right font-bold text-green-400 whitespace-nowrap">+{c.currency === 'EUR' ? '€' + money(c.amount) : money(c.amount) + ' L'}</td>
                <td className="p-2">{c.isTest && <span className="px-1.5 py-0.5 rounded bg-gray-600 text-[10px] font-bold uppercase">{t('Test')}</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
};
export default MyCredits;
