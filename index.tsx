import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const startApp = () => {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    console.error("Failed to find root element");
    return;
  }

  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
};

// Wait for DOM to be fully ready to avoid MutationObserver race conditions with Tailwind CDN
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}