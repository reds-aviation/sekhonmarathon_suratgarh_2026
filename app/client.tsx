import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Home from './page';
import './globals.css';
import './mobile-polish.css';
import './station-theme.css';
import './app-navigation.css';
import './event-gallery.css';
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Home />
  </StrictMode>,
);

if (import.meta.env.VITE_BUILD_TARGET === 'pages') {
  void import('./pwa').then(({ registerPublicOfflineWorker }) => {
    registerPublicOfflineWorker();
  });
}
