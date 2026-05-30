import './style.css';
import { AutographDashboard } from './ui/dashboard.ts';

declare global {
  interface Window {
    __agError?: string;
  }
}
window.addEventListener('error', (e) => {
  window.__agError = String(e.error?.stack ?? e.message);
});

function boot(): void {
  void new AutographDashboard(document.body)
    .start()
    .catch((err) => {
      console.error('Autograph dashboard failed to start:', err);
      window.__agError = String((err as Error)?.stack ?? err);
    });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
