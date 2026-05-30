import './style.css';
import { AutographDemo } from './ui/demo.ts';
import { startHero } from './ui/hero.ts';
import { maybe } from './ui/dom.ts';

function revealOnScroll(): void {
  const items = document.querySelectorAll<HTMLElement>('[data-reveal]');
  if (!('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('in-view'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          io.unobserve(entry.target);
        }
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
  );
  items.forEach((el) => io.observe(el));
}

function smoothAnchors(): void {
  document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (!id || id === '#') return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function boot(): void {
  const year = maybe(document, '#ag-year');
  if (year) year.textContent = String(new Date().getFullYear());

  const heroA = maybe<HTMLCanvasElement>(document, '#ag-hero-a');
  const heroB = maybe<HTMLCanvasElement>(document, '#ag-hero-b');
  if (heroA && heroB) startHero(heroA, heroB);

  const demoRoot = maybe<HTMLElement>(document, '#demo');
  if (demoRoot) {
    void new AutographDemo(demoRoot).start().catch((err) => {
      console.error('Autograph demo failed to start:', err);
      const note = maybe(demoRoot, '#ag-seed-note');
      if (note) note.textContent = 'the live demo could not start in this browser — the story below still stands';
    });
  }

  revealOnScroll();
  smoothAnchors();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
