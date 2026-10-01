# Raag eBook — update to the new edition (Raag Sangrah) · Oct 2026

## Where things are configured
| What | File → setting |
|---|---|
| Selling price ₹649 (what is charged) | `google-apps-script/Code.txt` (Code.gs) → `CONFIG.PRICE_INR: 649` (creates the Razorpay order + verifies the amount) **and** `js/config.js` → `PRODUCT_PRICE: 649` (shown on the site, Pixel value). Both must match. |
| Reference price ₹2,100 (display only) | `js/config.js` → `ORIGINAL_PRICE: 2100` (fills every `[data-original-price]`, the "You save ₹1,451" badge is calculated) |
| New Drive delivery link | `google-apps-script/Code.txt` → `CONFIG.DRIVE_LINK = 'https://drive.google.com/drive/folders/1eB8Yi4KIq1J6tqz3zKuPVT1zinPuWS8t?usp=sharing'`. This is the only place. It feeds the success page download button (`verify` response), the delivery email and the reconcile/webhook paths. |
| Preview images | `js/ebook.js` → `previews` array → `assets/preview/raag-new-preview-1…4.webp` + final `{ unlock: true }` slide (`#previewUnlock` in `index.html`, styles in `css/ebook.css`) |

## Files changed
- `google-apps-script/Code.txt`: PRICE_INR 999 → 649, new DRIVE_LINK, the email copy is now English, and the order cache key now includes the price.
- `js/config.js`: PRODUCT_PRICE 649, ORIGINAL_PRICE 2100, unused Hindi PRODUCT_NAME_HI removed. Reviews left unchanged, as you asked.
- `js/ebook.js`: new preview list plus the unlock slide. A saved order created at a different price is discarded. The arrow is removed together with the original price. The CTA notes are now English sargam (S R G M P D N).
- `js/success.js`: English subtitle (comment price updated).
- `index.html`: all copy is now English and describes the new edition (typeset, English sargam notation). Prices are ₹2,100 → ₹649. The 30 Raag list shows the English name above the Hindi name, with spellings from the new eBook. Also new cover/OG image, schema.org updated (price 649, inLanguage en), unlock slide markup, and the footer's Alankaar mention removed.
- `css/ebook.css`: raag chip order styling, renamed hero tagline class, unlock slide styles.
- `success.html`, `policies/*.html`: new cover/favicon. Policies now state the right price, language and format.
- `SETUP_GUIDE.md`: prices and checklist updated, update log added.
- Assets: added `raag-sangrah-cover-{200,480,760}.webp`, `og-image-raag-sangrah.jpg`, `preview/raag-new-preview-{1..4,locked}.webp`. Removed the old cover, OG and preview images.

## Deploy order (important)
1. Apps Script first: paste Code.txt into the Raag Apps Script project → Deploy → Manage deployments → ✏️ → Version: **New version** → Deploy. The /exec URL stays the same.
2. Then publish the website files.

## Update 2
- New hero cover from your image ("30 Famous Raags") → `assets/raag-sangrah-cover-{200,480,760}.webp` (also favicon, success page, OG image).
- Final preview slide now uses your "Unlock Full Raag eBook" design → `assets/preview/raag-unlock-full-ebook.webp`; the whole slide links to checkout (#buy).
- Safety net in index.html: if a script ever fails, content still appears after 2.5 s (the page can no longer go blank).
