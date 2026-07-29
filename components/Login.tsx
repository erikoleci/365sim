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
      const user = mode === 'login'
        ? await api.login(username, password)
        : await api.register(name, username, password);
      onAuthenticated(user);
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center p-4">
      <div className="bg-brand-panel w-full max-w-sm rounded shadow-2xl border border-brand-divider p-8">
        <div className="text-center mb-8">
          <div className="font-bold text-3xl tracking-tighter italic text-white mb-2">
            bet<span className="text-brand-yellow">365</span>sim
          </div>
          <p className="text-brand-textMuted text-sm">
            {mode === 'login' ? 'Secure Login' : 'Create an Account'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {mode === 'register' && (
            <div>
              <label className="block text-xs font-bold text-brand-textMuted mb-2 uppercase">Full Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-brand-bg border border-brand-divider rounded p-3 text-white focus:border-brand-yellow outline-none transition-colors"
                placeholder="Your name"
                required
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-brand-textMuted mb-2 uppercase">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-brand-bg border border-brand-divider rounded p-3 text-white focus:border-brand-yellow outline-none transition-colors"
              placeholder="Enter username"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-brand-textMuted mb-2 uppercase">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-brand-bg border border-brand-divider rounded p-3 text-white focus:border-brand-yellow outline-none transition-colors"
              placeholder={mode === 'register' ? 'At least 6 characters' : 'Enter password'}
              required
            />
          </div>

          {error && (
            <div className="bg-red-900/20 border border-red-900/50 text-red-400 text-xs p-3 rounded text-center">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-brand-header hover:bg-brand-headerDark text-white font-bold py-3 rounded transition-colors shadow-lg disabled:opacity-50"
          >
            {isSubmitting ? 'Please wait...' : mode === 'login' ? 'Log In' : 'Create Account'}
          </button>

          <button
            type="button"
            onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
            className="w-full text-center text-xs text-brand-textMuted hover:text-white underline"
          >
            {mode === 'login' ? "Don't have an account? Register" : 'Already have an account? Log in'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;
