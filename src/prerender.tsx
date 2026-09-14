import { renderToString } from 'react-dom/server';
import App from './App';

/** Build-time render of the initial (no file) screen; injected into index.html by vite.config.ts. */
export const render = () => renderToString(<App />);
