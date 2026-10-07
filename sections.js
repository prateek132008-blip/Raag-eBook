/* Renders the editable content files (curriculum, FAQ, teacher, gurus, reviews) into the page. */
import { CURRICULUM } from '../content/curriculum.js';
import { FAQS } from '../content/faqs.js';
import { TEACHER, GURUS } from '../content/teachers.js';
import { TEXT_REVIEWS, IMAGE_REVIEWS, VIDEO_REVIEWS } from '../content/testimonials.js';
import { escapeHtml as e, picture } from '../core/utils.js';
import { icons } from './ui.js';
import { videoMarkup, initVideos } from './video.js';
import { openGallery } from './books.js';
import { ASSET_CONFIG } from '../config.js';

const stars = (n = 5) => `<span class="stars" aria-label="${n} out of 5 stars">${icons.star.repeat(n)}</span>`;

/** Curriculum: 3 short month cards + the real PDF pages (tap to zoom) + download. */
export function renderCurriculum(el) {
  if (!el) return;
  const c = CURRICULUM;
  const pdf = ASSET_CONFIG.CURRICULUM_PDF;
  el.innerHTML = `
    ${c.facts && c.facts.length ? `<ul class="curr-facts" data-reveal>${c.facts.map((f) => `
      <li><b>${e(f.value)}</b><span>${e(f.label)}</span></li>`).join('')}</ul>` : ''}
    <div class="month-grid">
      <span class="curr-path" aria-hidden="true"><i></i></span>${c.months.map((m, i) => `
      <article class="month-card" data-reveal style="--d:${i * 140}ms">
        <span class="month-step" aria-hidden="true">${i + 1}</span>
        <span class="curr-badge">${e(m.label)}</span>
        <h3>${e(m.title)}</h3>
        <ul>${m.highlights.map((h) => `<li>${e(h)}</li>`).join('')}</ul>
        ${m.outcome ? `<p class="month-outcome"><span>You’ll be able to</span>${e(m.outcome)}</p>` : ''}
      </article>`).join('')}</div>
    <div class="curr-pdf" data-reveal>
      <div class="curr-stack">${c.pages.map((p, i) => `
        <button type="button" class="curr-page" data-page="${i}" style="--i:${i}" aria-label="Open ${e(p.caption)}">
          ${picture(p.img, p.caption, { width: p.w, height: p.h })}
        </button>`).join('')}</div>
      <div class="curr-pdf-body">
        <span class="curr-pdf-tag">PDF · ${c.pages.length} pages</span>
        <h3 class="h5">Full curriculum, week by week</h3>
        <p class="muted small">Every topic, technique and song type — tap a month to preview the page.</p>
        <div class="curr-pdf-links">${c.pages.map((p, i) => `
          <button type="button" class="curr-chip" data-page="${i}">${e(c.months[i] ? c.months[i].label : `Page ${i + 1}`)}</button>`).join('')}
          ${pdf ? `<a class="curr-open" href="${e(pdf)}" target="_blank" rel="noopener">Open PDF ↗</a>` : ''}
        </div>
      </div>
    </div>`;
  el.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-page]');
    if (b) openGallery(c.pages.map((p) => ({ img: p.img, caption: p.caption })), Number(b.dataset.page));
  });
}

export function renderFAQ(el) {
  if (!el) return;
  const groups = (el.dataset.faq || '').split(',').map((s) => s.trim()).filter(Boolean);
  const items = [];
  el.innerHTML = groups.map((g) => {
    const list = FAQS[g] || [];
    items.push(...list);
    return list.map((f) => `
      <details class="faq-item"><summary>${e(f.q)}<span class="faq-icon" aria-hidden="true"></span></summary><div class="faq-a"><p>${e(f.a)}</p></div></details>`).join('');
  }).join('');
  const ld = document.createElement('script');
  ld.type = 'application/ld+json';
  ld.textContent = JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: items.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) });
  document.head.appendChild(ld);
}

/** Abhishek's profile (the online-class teacher). */
export function renderTeacher(el) {
  if (!el) return;
  const t = TEACHER;
  const stats = [
    t.experience && { k: t.experience, v: 'teaching' },
    t.studentsTaught && { k: t.studentsTaught, v: 'students' },
    { k: '1-on-1', v: 'live classes' },
    { k: '5', v: 'countries' },
  ].filter(Boolean);
  el.innerHTML = `
    <div class="founder-media">${picture(t.photo, `${t.name} with his guitar`, { width: 900, height: 1200 })}</div>
    <div class="founder-copy">
      <p class="eyebrow">${e(t.role)}</p>
      <h2 class="h2" id="teacher-title">Meet ${e(t.name)}</h2>
      <p class="lead">${e(t.intro)}</p>
      <dl class="stat-row">${stats.map((s) => `<div><dt>${e(s.k)}</dt><dd>${e(s.v)}</dd></div>`).join('')}</dl>
      <ul class="check-list">${t.points.map((a) => `<li>${icons.check}<span>${e(a)}</span></li>`).join('')}</ul>
    </div>`;
}

/** Small, respectful "musical gurus" strip — these are Abhishek's teachers, not staff. */
export function renderGurus(el) {
  if (!el) return;
  el.innerHTML = GURUS.map((g) => `<li class="guru"><span>${e(g.name)}</span></li>`).join('');
}

const initials = (name) => name.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const forProduct = (list, product) => list.filter((r) => !product || r.product === 'any' || r.product === product);

/** data-reviews="fingerstyle|chord|class", data-review-kinds="video,text,image", data-limit="3" (text quotes) */
export function renderReviews(el) {
  if (!el) return;
  const product = el.dataset.reviews || '';
  const kinds = (el.dataset.reviewKinds || 'video,text,image').split(',');
  const limit = Number(el.dataset.limit || 99);
  let html = '';
  if (kinds.includes('video')) {
    const vids = forProduct(VIDEO_REVIEWS, product);
    if (vids.length) html += `<div class="rail rail--videos">${vids.map((v) => `<figure class="rail-item">${videoMarkup(v, { title: v.caption })}<figcaption>${e(v.name)}${v.place ? ` · ${e(v.place)}` : ''}</figcaption></figure>`).join('')}</div>`;
  }
  if (kinds.includes('text')) {
    html += `<div class="quote-row">${forProduct(TEXT_REVIEWS, product).slice(0, limit).map((r) => `
      <figure class="quote">
        ${stars()}
        <blockquote><p>“${e(r.quote)}”</p></blockquote>
        <figcaption><span class="quote-avatar" aria-hidden="true">${e(initials(r.name))}</span><span><b>${e(r.name)}</b><small>${e(r.place)}</small></span></figcaption>
      </figure>`).join('')}</div>`;
  }
  if (kinds.includes('image')) {
    const imgs = forProduct(IMAGE_REVIEWS, product);
    const grid = `<div class="masonry">${imgs.map((r) => `<figure class="shot">${picture(r.image, r.alt, { width: r.w, height: r.h })}</figure>`).join('')}</div>`;
    if (imgs.length) html += `<details class="shots-toggle"><summary>See the original WhatsApp messages (${imgs.length})</summary>${grid}</details>`;
  }
  el.innerHTML = html;
  initVideos(el);
}
