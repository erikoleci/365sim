import React from 'react';

// If one game ever throws while rendering, show a small recovery card instead of a blank page, and let the player go back.
export default class GameBoundary extends React.Component<{ onBack: () => void; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: unknown) { console.error('[casino] game crashed', err); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="max-w-sm mx-auto mt-24 p-6 rounded-2xl bg-black/60 border border-white/15 text-center text-white">
        <div className="text-3xl mb-2">⚠️</div>
        <div className="font-bold mb-1">This game hit a problem</div>
        <div className="text-xs text-gray-400 mb-4">Your balance is safe. Go back and open it again.</div>
        <button onClick={this.props.onBack} className="px-5 py-2.5 rounded-xl font-bold bg-brand-yellow text-black">Back to casino</button>
      </div>
    );
  }
}
