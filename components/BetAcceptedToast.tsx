import React from 'react';
import { useI18n } from '../i18n';

// Shown right after a ticket was booked: the agent "accepted" it. Sits above the mobile bottom bar.
const BetAcceptedToast: React.FC<{ show: boolean; onDismiss: () => void }> = ({ show, onDismiss }) => {
  const { t } = useI18n();
  if (!show) return null;
  return (
    <div
      role="status"
      onClick={onDismiss}
      className="fixed left-3 right-3 bottom-24 md:bottom-6 md:left-auto md:right-6 md:max-w-sm z-50 bg-emerald-600 text-white text-sm font-bold rounded-lg shadow-2xl px-4 py-3 cursor-pointer text-center"
    >
      {t('Agjenti pranoi biletën tuaj')}
    </div>
  );
};

export default BetAcceptedToast;
