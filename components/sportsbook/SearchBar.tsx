import React, { useCallback, useState } from 'react';
import { Match } from '../../types';
import { useI18n } from '../../i18n';

const HISTORY_KEY = 'searchHistory';
const HISTORY_LIMIT = 8;

const readHistory = (): string[] => {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
};
const writeHistory = (list: string[]) => {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch { /* storage unavailable */ }
};

interface Props {
  query: string;
  onQueryChange: (query: string) => void;
  suggestions: { teams: string[]; leagues: string[]; matches: Match[] };
  favoriteTeams: Set<string>;
  leagueText: (key: string) => string;
  /** Plain (Albanian) league label, remembered in the history. */
  leagueLabel: (key: string) => string;
  onPickLeague: (leagueKey: string) => void;
  onPickMatch: (matchId: string) => void;
}

const SECTION = 'px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-brand-textMuted';
const ITEM = 'w-full text-left px-3 py-2 text-white hover:bg-[#444]';

/** Search box with recent searches and instant suggestions (teams, leagues, matches). */
const SearchBar: React.FC<Props> = ({ query, onQueryChange, suggestions, favoriteTeams, leagueText, leagueLabel, onPickLeague, onPickMatch }) => {
  const { t } = useI18n();
  const [isFocused, setIsFocused] = useState(false);
  const [history, setHistory] = useState<string[]>(readHistory);

  const remember = useCallback((term: string) => {
    const trimmed = term.trim();
    if (!trimmed) return;
    setHistory((prev) => {
      const next = [trimmed, ...prev.filter((x) => x.toLowerCase() !== trimmed.toLowerCase())].slice(0, HISTORY_LIMIT);
      writeHistory(next);
      return next;
    });
  }, []);

  // mouseDown (not click) so the choice lands before the input's blur closes the dropdown.
  const choose = (action: () => void) => (e: React.MouseEvent) => { e.preventDefault(); action(); setIsFocused(false); };
  const searching = query.trim().length > 0;
  const { teams, leagues, matches } = suggestions;
  const hasSuggestions = teams.length + leagues.length + matches.length > 0;
  const showDropdown = isFocused && (searching ? hasSuggestions : history.length > 0);

  return (
    <div className="relative">
      <div className="bg-brand-panel p-3 rounded flex items-center gap-2 border border-brand-divider">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-brand-textMuted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
        <input
          type="text"
          placeholder={t('Kërko skuadra, liga...')}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setTimeout(() => setIsFocused(false), 150)}
          onKeyDown={(e) => { if (e.key === 'Enter') { remember(query); (e.target as HTMLInputElement).blur(); } }}
          className="bg-transparent text-white text-sm w-full outline-none placeholder-brand-textMuted"
        />
        {query && <button onClick={() => onQueryChange('')} className="text-brand-textMuted hover:text-white shrink-0">✕</button>}
      </div>

      {showDropdown && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-brand-panel border border-brand-divider rounded shadow-xl max-h-80 overflow-y-auto text-sm">
          {!searching && (
            <>
              <div className={`${SECTION} flex justify-between items-center`}>
                <span>{t('Kërkime të fundit')}</span>
                <button onMouseDown={(e) => { e.preventDefault(); setHistory([]); try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ } }} className="hover:text-white">{t('Pastro')}</button>
              </div>
              {history.map((term) => (
                <button key={term} onMouseDown={choose(() => { onQueryChange(term); remember(term); })} className="w-full text-left px-3 py-2 text-brand-textMuted hover:bg-[#444] hover:text-white flex items-center gap-2">
                  <span className="opacity-50">↺</span>{term}
                </button>
              ))}
            </>
          )}

          {searching && teams.length > 0 && (
            <>
              <div className={SECTION}>{t('Skuadra')}</div>
              {teams.map((team) => (
                <button key={team} onMouseDown={choose(() => { onQueryChange(team); remember(team); })} className={`${ITEM} flex items-center justify-between`}>
                  <span>{team}</span>
                  {favoriteTeams.has(team) && <span className="text-brand-yellow text-xs">★</span>}
                </button>
              ))}
            </>
          )}

          {searching && leagues.length > 0 && (
            <>
              <div className={SECTION}>{t('Liga')}</div>
              {leagues.map((league) => (
                <button key={league} onMouseDown={choose(() => { onPickLeague(league); onQueryChange(''); remember(leagueLabel(league)); })} className={ITEM}>
                  {leagueText(league)}
                </button>
              ))}
            </>
          )}

          {searching && matches.length > 0 && (
            <>
              <div className={SECTION}>{t('Ndeshje')}</div>
              {matches.map((m) => (
                <button key={m.id} onMouseDown={choose(() => { remember(query); onPickMatch(m.id); onQueryChange(''); })} className={ITEM}>
                  {m.homeTeam} <span className="text-brand-textMuted">vs</span> {m.awayTeam}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default SearchBar;
