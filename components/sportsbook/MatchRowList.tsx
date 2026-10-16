import React from 'react';
import MatchRow from '../MatchCard';
import { Match } from '../../types';
import { MatchRowActions } from './types';

interface Props {
  matches: Match[];
  actions: MatchRowActions;
}

/** A divided list of match rows sharing the same actions. */
const MatchRowList: React.FC<Props> = ({ matches, actions }) => (
  <div className="divide-y divide-brand-divider">
    {matches.map((match) => (
      <MatchRow
        key={match.id}
        match={match}
        onBetClick={actions.onBetClick}
        onOpenDetail={actions.onOpenDetail}
        isAdmin={actions.isAdmin}
        onSettleMatch={actions.onSettleMatch}
        isSimulating={actions.simulatingMatchId === match.id}
        selectedIds={actions.selectedIds}
        favoriteTeams={actions.favoriteTeams}
        onToggleFavoriteTeam={actions.onToggleFavoriteTeam}
      />
    ))}
  </div>
);

export default MatchRowList;
