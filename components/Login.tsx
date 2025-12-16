import React, { useState } from 'react';

interface LoginProps {
  onLogin: (username: string, password: string) => boolean;
}

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const success = onLogin(username, password);
    if (!success) {
      setError('Invalid credentials');
    }
  };

  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center p-4">
      <div className="bg-brand-panel w-full max-w-sm rounded shadow-2xl border border-brand-divider p-8">
        <div className="text-center mb-8">
          <div className="font-bold text-3xl tracking-tighter italic text-white mb-2">
            bet<span className="text-brand-yellow">365</span>sim
          </div>
          <p className="text-brand-textMuted text-sm">Secure Login</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-xs font-bold text-brand-textMuted mb-2 uppercase">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-brand-bg border border-brand-divider rounded p-3 text-white focus:border-brand-yellow outline-none transition-colors"
              placeholder="Enter username"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-brand-textMuted mb-2 uppercase">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-brand-bg border border-brand-divider rounded p-3 text-white focus:border-brand-yellow outline-none transition-colors"
              placeholder="Enter password"
            />
          </div>

          {error && (
            <div className="bg-red-900/20 border border-red-900/50 text-red-400 text-xs p-3 rounded text-center">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="w-full bg-brand-header hover:bg-brand-headerDark text-white font-bold py-3 rounded transition-colors shadow-lg"
          >
            Log In
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;