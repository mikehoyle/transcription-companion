import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import App from './App';
import { engine } from './audio/engine';
import * as controller from './controller';
import { store } from './store';
import './styles.css';

if (import.meta.env.DEV) {
  // Debug handle for poking at the app from the devtools console.
  (window as unknown as Record<string, unknown>).__tc = { engine, store, controller };
}

const root = document.getElementById('root')!;
const app = (
  <StrictMode>
    <App />
  </StrictMode>
);

// Production builds ship the welcome screen pre-rendered (see vite.config.ts), so hydrate it.
if (root.hasChildNodes()) hydrateRoot(root, app);
else createRoot(root).render(app);
