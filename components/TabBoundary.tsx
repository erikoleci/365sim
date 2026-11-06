import React from 'react';

/** Keeps one broken tab from blanking the whole page: shows a small message and a retry button instead. */
export default class TabBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error('Tab crashed', error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="bg-brand-panel border border-red-500/60 rounded p-4 text-sm">
        <div className="font-bold text-red-400 mb-1">Ky tab pati një gabim.</div>
        <div className="text-brand-textMuted text-xs mb-3 break-words">{this.state.error.message}</div>
        <button onClick={() => { try { Object.keys(localStorage).filter((k) => k.startsWith('cached')).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ } this.setState({ error: null }); }} className="px-3 py-1.5 rounded bg-brand-yellow text-black text-xs font-bold uppercase">Provo përsëri</button>
      </div>
    );
  }
}
