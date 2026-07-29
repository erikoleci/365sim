import React, { useState } from 'react';
import { User } from '../types';
import * as api from '../services/api';

interface LoginProps {
  onAuthenticated: (user: User) => void;
}

const Login: React.FC<LoginProps> = ({ onAuthenticated }) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      const user = mode === 'login' ? await api.login(username, password) : await api.register(name, username, password);
      onAuthenticated(user);
    } catch (err: any) {
      setError(err.message || 'Diçka shkoi keq');
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClass =
    'w-full bg-brand-surface2 border border-brand-border rounded-lg p-3 text-brand-text placeholder:text-brand-textFaint focus:border-brand-accent outline-none transition-colors';

  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center p-4 relative overflow-hidden">
      {/* Subtle radial glow behind the card — the one intentional atmospheric moment on this screen */}
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle at 50% 20%, rgba(34,230,163,0.08), transparent 60%)' }} />

      <div className="relative bg-brand-surface w-full max-w-sm rounded-2xl shadow-popover border border-brand-border p-8 animate-fadeIn">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 font-display font-extrabold text-2xl text-brand-text mb-3">
            <span className="w-9 h-9 rounded-lg bg-brand-accent/15 border border-brand-accent/30 flex items-center justify-center text-brand-accent">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 2l3 6 6 1-4.5 4.5L18 20l-6-3-6 3 1.5-6.5L3 9l6-1z" />
              </svg>
            </span>
            365<span className="text-brand-accent">sim</span>
          </div>
          <p className="text-brand-textMuted text-sm">{mode === 'login' ? 'Hyr në llogarinë tënde' : 'Krijo një llogari të re'}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {mode === 'register' && (
            <div>
              <label className="block text-xs font-semibold text-brand-textMuted mb-1.5">Emri i plotë</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Emri yt" required />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-brand-textMuted mb-1.5">Username</label>
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} className={inputClass} placeholder="Shkruaj username" required />
          </div>

          <div>
            <label className="block text-xs font-semibold text-brand-textMuted mb-1.5">Fjalëkalimi</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
              placeholder={mode === 'register' ? 'Të paktën 6 karaktere' : 'Shkruaj fjalëkalimin'}
              required
            />
          </div>

          {error && <div className="bg-brand-danger/10 border border-brand-danger/30 text-brand-danger text-xs p-3 rounded-lg text-center">{error}</div>}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-brand-accent hover:bg-brand-accentDark text-brand-bg font-bold py-3 rounded-lg transition-colors disabled:opacity-50"
          >
            {isSubmitting ? 'Duke pritur…' : mode === 'login' ? 'Hyr' : 'Krijo Llogari'}
          </button>

          <button
            type="button"
            onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
            className="w-full text-center text-xs text-brand-textMuted hover:text-brand-text transition-colors"
          >
            {mode === 'login' ? 'S\'ke llogari? Regjistrohu' : 'Ke tashmë llogari? Hyr'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;
