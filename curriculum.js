/* ✏️ ONLINE CLASS CURRICULUM — summary of the full PDF (assets/docs/sangeetseekho-curriculum.pdf).
   - months: the short cards shown on the homepage (keep 3–5 highlights each;
             'outcome' = the one line "what you can play after this month").
   - facts:  the small numbers strip above the cards.
   - pages:  images of the PDF pages shown in the "full curriculum" viewer
             (files in /assets/img/curriculum/, without .webp/.jpg).
   The PDF file path itself is in js/config.js → ASSET_CONFIG.CURRICULUM_PDF. */

export const CURRICULUM = {
  title: '3-month Bollywood fingerstyle curriculum',
  intro: 'From your first finger pattern to performing your own arrangement.',
  // Small facts strip shown above the month cards (value + label).
  facts: [
    { value: '3', label: 'months' },
    { value: '12', label: 'weeks, step by step' },
    { value: '1-on-1', label: 'live with Abhishek' },
    { value: '1', label: 'final performance' },
  ],
  months: [
    {
      label: 'Month 1',
      title: 'Fingerstyle Foundation',
      outcome: 'Play simple Bollywood melodies with a steady fingerpicking pattern.',
      highlights: ['Thumb, index, middle & ring technique', 'Travis picking & basic arpeggios', 'Bass + melody coordination', 'Easy Bollywood melodies'],
    },
    {
      label: 'Month 2',
      title: 'Fingerstyle Techniques',
      outcome: 'Play full songs — intro, verse & interlude — with expression.',
      highlights: ['Melody + bass + harmony together', 'Hammer-ons, pull-offs & slides', 'Percussive fingerstyle', 'Intros, interludes & song structure'],
    },
    {
      label: 'Month 3',
      title: 'Arrangement & Performance',
      outcome: 'Arrange and perform a Bollywood song in your own style.',
      highlights: ['Chord-melody & moving bass lines', 'Advanced voicings & dynamics', 'Create your own arrangements', 'Final project: perform your arrangement'],
    },
  ],
  pages: [
    { img: '/assets/img/curriculum/month-1', caption: 'Month 1 — Fingerstyle Foundation', w: 900, h: 1145 },
    { img: '/assets/img/curriculum/month-2', caption: 'Month 2 — Fingerstyle Techniques', w: 900, h: 967 },
    { img: '/assets/img/curriculum/month-3', caption: 'Month 3 — Arrangement & Performance', w: 900, h: 1205 },
  ],
};
