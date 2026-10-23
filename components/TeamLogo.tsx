import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { leagueCountry } from '../utils/leagueGrouping';
import { isTeamLogoIndexReady, loadTeamLogoIndex, resolveTeamLogo, subscribeTeamLogoIndex } from '../utils/teamLogos';

export type TeamLogoSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
const PX: Record<TeamLogoSize, number> = { xs: 14, sm: 18, md: 24, lg: 32, xl: 48 };

interface Props {
  /** Team name as the feed gives it. */
  name: string;
  /** Country group of the league (e.g. "Anglia"), only used to tell apart two same-named clubs. */
  country?: string | null;
  /** Alternative to `country`: the league key of the match; its country group is used. */
  league?: string;
  /** The provider's own crest URL, used only when the local collection has no logo. */
  providerLogo?: string;
  size?: TeamLogoSize | number;
  className?: string;
}

const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

/**
 * The one component that draws a team crest: local collection first, then the provider's crest,
 * then a neutral initials tile. The box has a fixed size, so nothing shifts while the logo loads
 * or when it is missing.
 */
const TeamLogo: React.FC<Props> = ({ name, country, league, providerLogo, size = 'sm', className = '' }) => {
  const px = typeof size === 'number' ? size : PX[size];
  // Re-render once when the (lazily fetched) index arrives; every instance shares the one fetch.
  const ready = useSyncExternalStore(subscribeTeamLogoIndex, isTeamLogoIndexReady, () => false);
  useEffect(() => { if (!ready) void loadTeamLogoIndex(); }, [ready]);

  const countryHint = country ?? (league ? leagueCountry(league) : null);
  const local = ready ? resolveTeamLogo(name, countryHint) : null;
  const [stage, setStage] = useState<'local' | 'provider' | 'none'>('local');
  const [retried, setRetried] = useState(false); // a failed local crest is fetched once more before giving up
  useEffect(() => { setStage('local'); setRetried(false); }, [name, local, providerLogo]);

  const src = stage === 'local' && local ? (retried ? `${local}?r=1` : local) : stage !== 'none' && providerLogo ? providerLogo : null;
  const box = { width: px, height: px };

  if (!src) {
    return (
      <span
        style={{ ...box, fontSize: Math.max(7, Math.round(px * 0.42)) }}
        className={`shrink-0 rounded-sm bg-[#444] text-brand-textMuted font-bold flex items-center justify-center leading-none select-none ${className}`}
        aria-hidden="true"
      >
        {initialsOf(name)}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      width={px}
      height={px}
      loading="lazy"
      decoding="async"
      draggable={false}
      style={box}
      className={`shrink-0 object-contain ${className}`}
      onError={() => {
        if (stage === 'local' && local && !retried) { setRetried(true); return; } // one retry (busy connection, blip)
        setStage((s) => (s === 'local' && providerLogo ? 'provider' : 'none'));
      }}
    />
  );
};

export default React.memo(TeamLogo);
