import React from 'react';
import { useI18n } from '../i18n';

// Shown when a pick is refused because it follows the same logic as a pick already on the slip
// (1+ and 2+ goals, Over 1.5 and Over 2.5, 1 and 1X ...). Sits above the mobile bottom bar.
const SlipBlockedToast: React.FC<{ list: string | null; onDismiss: () => void }> = ({ list, onDismiss }) => {
  const { t, tn } = useI18n();
  if (!list) return null;
  return (
    <div
      role="alert"
      onClick={onDismiss}
      className="fixed left-3 right-3 bottom-24 md:bottom-6 md:left-auto md:right-6 md:max-w-sm z-50 bg-red-600 text-white text-xs font-bold rounded-lg shadow-2xl px-4 py-3 cursor-pointer"
    >
      {t('Nuk shtohet: ka të njëjtën logjikë me {list}', { list: tn(list) })}
    </div>
  );
};

export default SlipBlockedToast;
