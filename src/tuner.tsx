import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { Tuner } from './tuner/Tuner';
import './styles.css';
import './tuner/tuner.css';

const root = document.getElementById('root')!;
const page = (
  <StrictMode>
    <Tuner />
  </StrictMode>
);

// Production builds ship this page pre-rendered too (see vite.config.ts), so hydrate it.
if (root.hasChildNodes()) hydrateRoot(root, page);
else createRoot(root).render(page);
