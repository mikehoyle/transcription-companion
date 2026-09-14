import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { engine } from './audio/engine';
import * as controller from './controller';
import { store } from './store';
import './styles.css';

if (import.meta.env.DEV) {
  // Debug handle for poking at the app from the devtools console.
  (window as unknown as Record<string, unknown>).__tc = { engine, store, controller };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
