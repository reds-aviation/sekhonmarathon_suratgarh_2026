import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PublicGuide } from './public-guide';
import './globals.css';
import './mobile-polish.css';
import './station-theme.css';
import './app-navigation.css';
import './event-gallery.css';
import './homepage-clarity.css';
import './participant-guidance.css';
import { registerPublicOfflineWorker } from './pwa';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PublicGuide />
  </StrictMode>,
);

void registerPublicOfflineWorker();
