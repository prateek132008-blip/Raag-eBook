/* Runs on every page: header, footer, floating buttons, Meta Pixel PageView,
   lead outbox, lazy videos, gentle reveal animations, and product price filling. */
import { initPixel } from './analytics/pixel.js';
import { renderHeader, renderFooter, renderFloating } from './components/layout.js';
import { initOutbox } from './core/api.js';
import { initVideos } from './components/video.js';
import { PRODUCT_CONFIG } from './config.js';
import { inr, getLeadSource } from './core/utils.js';
import { log } from './core/logger.js';

/** Fill every price on the page from PRODUCT_CONFIG (no prices hard-coded in HTML). */
export function fillPrices(root = document) {
  root.querySelectorAll('[data-price]').forEach((el) => { const p = PRODUCT_CONFIG[el.dataset.price]; if (p) el.textContent = inr(p.price); });
  root.querySelectorAll('[data-mrp]').forEach((el) => { const p = PRODUCT_CONFIG[el.dataset.mrp]; if (p) el.textContent = inr(p.mrp); });
  root.querySelectorAll('[data-off]').forEach((el) => { const p = PRODUCT_CONFIG[el.dataset.off]; if (p) el.textContent = `${Math.round((1 - p.price / p.mrp) * 100)}% OFF`; });
  root.querySelectorAll('[data-save]').forEach((el) => { const p = PRODUCT_CONFIG[el.dataset.save]; if (p) el.textContent = inr(p.mrp - p.price); });
}

function initReveal() {
  const els = document.querySelectorAll('[data-reveal]');
  if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { els.forEach((e) => e.classList.add('is-in')); return; }
  const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); } }), { rootMargin: '0px 0px -8% 0px' });
  els.forEach((e) => io.observe(e));
  // Sections rendered later by JavaScript (e.g. curriculum cards) must be revealed too —
  // otherwise they stay invisible and the area looks like an empty block.
  new MutationObserver((muts) => muts.forEach((m) => m.addedNodes.forEach((n) => {
    if (n.nodeType !== 1) return;
    [n, ...n.querySelectorAll('[data-reveal]')].forEach((e) => { if (e.matches && e.matches('[data-reveal]') && !e.classList.contains('is-in')) io.observe(e); });
  }))).observe(document.body, { childList: true, subtree: true });
}

let booted = false;
export function boot() {
  if (booted) return;
  booted = true;
  document.documentElement.classList.add('js');
  getLeadSource();   // remember where this visitor came from (ads/UTM) before they browse further
  initPixel();
  renderHeader();
  renderFooter();
  renderFloating();
  fillPrices();
  initVideos();
  initReveal();
  initOutbox();
  log('page.boot', { path: location.pathname });
}
