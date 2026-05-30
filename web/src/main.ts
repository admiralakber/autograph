import './style.css';
import { AutographDashboard } from './ui/dashboard.ts';

function boot(): void {
  void new AutographDashboard(document.body)
    .start()
    .catch((err) => console.error('Autograph dashboard failed to start:', err));
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
