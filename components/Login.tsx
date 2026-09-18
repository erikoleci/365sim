import React, { useState } from 'react';
import { User } from '../types';
import * as api from '../services/api';

interface LoginProps {
  onAuthenticated: (user: User) => void;
}

// Self-service registration is intentionally not offered here -- accounts
// are created by an Admin or Agent only (see AgentUsersPanel), so this is
// a login-only screen. See server/routes/auth.js for the backend side of
// that decision.
const Login: React.FC<LoginProps> = ({ onAuthenticated }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [slowConnect, setSlowConnect] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    setSlowConnect(false);
    // Free-tier hosting can take 50+ seconds to wake up from idle (see
    // services/api.ts's request() retry). A static "Please wait..." for
    // that whole time looks identical to a genuinely frozen page, so after
    // a few seconds switch to a message that explains what's actually
    // happening instead of leaving the person guessing.
    const slowTimer = setTimeout(() => setSlowConnect(true), 4000);
    try {
      const user = await api.login(username, password);
      onAuthenticated(user);
    } catch (err: any) {
      setError(err.message || 'Diçka shkoi keq. Provo përsëri.');
    } finally {
      clearTimeout(slowTimer);
      setIsSubmitting(false);
      setSlowConnect(false);
    }
  };

  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center p-4 relative overflow-hidden">
      {/* Soft ambient glow behind the card -- purely decorative, no assets */}
      <div className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 w-[36rem] h-[36rem] rounded-full bg-brand-yellow/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-20 w-[28rem] h-[28rem] rounded-full bg-brand-accent/10 blur-3xl" />

      <div className="relative w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="font-bold text-4xl tracking-tighter italic text-white mb-1">
            bet<span className="text-brand-yellow">365</span>sim
          </div>
          <p className="text-brand-textMuted text-sm">Hyr në llogarinë tënde</p>
        </div>

        <div className="bg-brand-panel/90 backdrop-blur w-full rounded-2xl shadow-2xl border border-brand-divider p-7">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="login-username" className="block text-xs font-bold text-brand-textMuted mb-2 uppercase tracking-wide">
                Përdoruesi
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-brand-textMuted">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </span>
                <input
                  id="login-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-brand-bg border border-brand-divider rounded-lg py-3 pl-10 pr-3 text-white focus:border-brand-yellow focus:ring-1 focus:ring-brand-yellow/40 outline-none transition-colors"
                  placeholder="Shkruaj përdoruesin"
                  autoComplete="username"
                  autoFocus
                  required
                />
              </div>
            </div>

            <div>
              <label htmlFor="login-password" className="block text-xs font-bold text-brand-textMuted mb-2 uppercase tracking-wide">
                Fjalëkalimi
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-brand-textMuted">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </span>
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-brand-bg border border-brand-divider rounded-lg py-3 pl-10 pr-10 text-white focus:border-brand-yellow focus:ring-1 focus:ring-brand-yellow/40 outline-none transition-colors"
                  placeholder="Shkruaj fjalëkalimin"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-brand-textMuted hover:text-white transition-colors"
                  aria-label={showPassword ? 'Fshih fjalëkalimin' : 'Shfaq fjalëkalimin'}
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div className="bg-red-900/20 border border-red-900/50 text-red-400 text-xs p-3 rounded-lg text-center">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-brand-yellow hover:bg-yellow-400 text-black font-bold py-3 rounded-lg transition-colors shadow-lg shadow-brand-yellow/10 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (slowConnect ? 'Duke u lidhur me serverin…' : 'Një moment…') : 'Hyr'}
            </button>
          </form>
        </div>

        <p className="text-center text-brand-textMuted text-xs mt-5">
          S'ke llogari? Kontakto administratorin ose agjentin tënd për ta hapur.
        </p>
      </div>
    </div>
  );
};

export default Login;
