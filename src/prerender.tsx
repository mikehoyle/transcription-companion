import { renderToString } from 'react-dom/server';
import App from './App';
import { Tuner } from './tuner/Tuner';

/** Build-time renders of each page's initial screen; injected into its HTML by vite.config.ts. */
export const render = () => renderToString(<App />);
export const renderTuner = () => renderToString(<Tuner />);
