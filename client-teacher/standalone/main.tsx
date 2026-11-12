// The standalone demo: the teacher's page with the lesson server running in the same tab.
// Built by vite.standalone.config.ts; nothing here talks to our servers but the feedback at the end
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './node-timers';
import { routeApiInPage } from './api';
import '../../server/src/index';
import '../src/index.css';
import App from '../src/App.tsx';

routeApiInPage();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
