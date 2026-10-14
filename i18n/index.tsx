import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { en } from './en';

// Albanian is the source language of the whole UI: every user-facing string in
// the code is written in Albanian and passed through t(). English is looked up
// in ./en.ts by that exact Albanian text; anything without an entry falls back
// to the Albanian original, so a missing translation never breaks the screen.
//
//   t('Të gjitha')                       -> "Të gjitha" / "All"
//   t('{n} ndeshje', { n: 5 })           -> "5 ndeshje" / "5 matches"

export type Lang = 'sq' | 'en';

export const LANGUAGES: { code: Lang; label: string; name: string }[] = [
  { code: 'sq', label: 'SQ', name: 'Shqip' },
  { code: 'en', label: 'EN', name: 'English' },
];

export const DEFAULT_LANG: Lang = 'sq';
const STORAGE_KEY = 'lang';

const LOCALES: Record<Lang, string> = { sq: 'sq-AL', en: 'en-GB' };

type Vars = Record<string, string | number>;

function readStoredLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'sq' || stored === 'en') return stored;
  } catch {
    /* storage can be blocked (private mode) -- fall through to the default */
  }
  return DEFAULT_LANG;
}

// Module-level copy of the active language so plain (non-React) helpers in
// utils/ can translate too. The provider keeps it in sync; components that
// display translated text must still use the hook so they re-render on change.
let currentLang: Lang = readStoredLang();

export function getLang(): Lang {
  return currentLang;
}

export function getLocale(lang: Lang = currentLang): string {
  return LOCALES[lang];
}

export function translate(lang: Lang, text: string, vars?: Vars): string {
  let out = lang === 'en' ? en[text] ?? text : text;
  if (vars) {
    out = out.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
  }
  return out;
}

// Server-supplied names (market titles, outcome labels such as "Mbi 2.5" or
// "Arsenal ose Barazim") are partly dynamic, so besides the exact lookup a few
// patterns are translated structurally. Team names are never touched.
export function translateName(lang: Lang, text: string): string {
  if (lang !== 'en' || !text) return text;
  if (en[text] !== undefined) return en[text];
  let m = text.match(/^Mbi (.+)$/);
  if (m) return `Over ${m[1]}`;
  m = text.match(/^Nën (.+)$/);
  if (m) return `Under ${m[1]}`;
  m = text.match(/^(.+) ose Barazim$/);
  if (m) return `${m[1]} or Draw`;
  m = text.match(/^(.+) ose (.+)$/);
  if (m) return `${m[1]} or ${m[2]}`;
  return text;
}

// For helpers outside React components (utils/*.ts).
export function tr(text: string, vars?: Vars): string {
  return translate(currentLang, text, vars);
}

interface I18nValue {
  lang: Lang;
  locale: string;
  setLang: (lang: Lang) => void;
  t: (text: string, vars?: Vars) => string;
  // Translate a server-supplied market/outcome name (see translateName).
  tn: (text: string) => string;
}

const I18nContext = createContext<I18nValue>({
  lang: DEFAULT_LANG,
  locale: LOCALES[DEFAULT_LANG],
  setLang: () => {},
  t: (text, vars) => translate(DEFAULT_LANG, text, vars),
  tn: (text) => text,
});

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Lang>(() => {
    const initial = readStoredLang();
    currentLang = initial;
    return initial;
  });

  const setLang = useCallback((next: Lang) => {
    currentLang = next;
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    currentLang = lang;
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo<I18nValue>(
    () => ({
      lang,
      locale: LOCALES[lang],
      setLang,
      t: (text, vars) => translate(lang, text, vars),
      tn: (text) => translateName(lang, text),
    }),
    [lang, setLang]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}
