import React from 'react';
import TeamLogo, { TeamLogoSize } from './TeamLogo';

interface Props {
  home: string;
  away: string;
  league?: string;
  separator?: string;
  size?: TeamLogoSize;
  className?: string;
}

/** "[logo] Home v [logo] Away" on one line: used wherever a match is named in running text (bet lists, search). */
const MatchupLabel: React.FC<Props> = ({ home, away, league, separator = 'v', size = 'xs', className = '' }) => (
  <span className={`inline-flex items-center gap-1 min-w-0 max-w-full align-middle ${className}`}>
    <TeamLogo name={home} league={league} size={size} />
    <span className="truncate">{home}</span>
    <span className="shrink-0 opacity-70">{separator}</span>
    <TeamLogo name={away} league={league} size={size} />
    <span className="truncate">{away}</span>
  </span>
);

export default MatchupLabel;
