import React from 'react';

interface SportItem {
  label: string;
  active?: boolean;
  disabled?: boolean;
}

const SPORTS: SportItem[] = [
  { label: 'Home' },
  { label: 'Soccer', active: true },
  { label: 'Basketball' },
  { label: 'Baseball' },
  { label: 'Ice Hockey' },
  { label: 'Tennis' },
  { label: 'Handball' },
  { label: 'Rugby' },
  { label: 'Aussie rules' },
  { label: 'Football' },
  { label: 'Snooker' },
  { label: 'Table tennis' },
  { label: 'Cricket' },
  { label: 'Volleyball' },
  { label: 'Futsal' },
  { label: 'Badminton' },
];

interface SportSidebarProps {
  onSelectSoccer: () => void;
}

// Left-hand sport list, styled to match the reference screenshots:
// dark panel, green search box, star icons, active sport highlighted.
const SportSidebar: React.FC<SportSidebarProps> = ({ onSelectSoccer }) => {
  return (
    <aside className="hidden lg:flex flex-col w-[190px] shrink-0 bg-[#3b3b3b] rounded overflow-hidden self-start">
      <div className="p-2">
        <div className="flex items-center bg-[#282828] border border-[#555] rounded px-2 py-1.5">
          <input
            placeholder="Search"
            className="bg-transparent outline-none text-xs text-brand-text placeholder:text-brand-textMuted w-full"
          />
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" className="w-4 h-4 fill-brand-textMuted shrink-0">
            <path fillRule="evenodd" d="M9 3a6 6 0 104.472 10.03l3.249 3.249a.75.75 0 101.06-1.06l-3.248-3.25A6 6 0 009 3zM4.5 9a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0z" clipRule="evenodd" />
          </svg>
        </div>
      </div>

      <nav className="flex flex-col text-[13px]">
        {SPORTS.map((sport) => (
          <div
            key={sport.label}
            onClick={sport.label === 'Soccer' ? onSelectSoccer : undefined}
            className={`flex items-center justify-between px-3 py-2 cursor-pointer border-t border-[#333] ${
              sport.active ? 'bg-brand-header text-white font-bold' : 'text-brand-text hover:bg-[#454545]'
            }`}
          >
            <span>{sport.label}</span>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" className={`w-3.5 h-3.5 ${sport.active ? 'fill-brand-yellow' : 'fill-brand-textMuted'}`}>
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.958a1 1 0 00.95.69h4.162c.969 0 1.371 1.24.588 1.81l-3.368 2.447a1 1 0 00-.364 1.118l1.287 3.959c.3.92-.755 1.688-1.54 1.118l-3.367-2.448a1 1 0 00-1.176 0l-3.367 2.448c-.784.57-1.838-.198-1.539-1.118l1.286-3.96a1 1 0 00-.363-1.117L2.983 9.386c-.783-.57-.38-1.81.588-1.81h4.163a1 1 0 00.95-.689l1.285-3.958z" />
            </svg>
          </div>
        ))}
      </nav>
    </aside>
  );
};

export default SportSidebar;
