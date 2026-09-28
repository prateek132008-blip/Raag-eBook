# 30 Raag eBook Website — Setup, Deployment & Testing Guide

Everything you must fill in lives in **three values in two files**:

| # | What | File | Variable |
|---|------|------|----------|
| 1 | Meta Pixel ID | `js/config.js` | `META_PIXEL_ID` |
| 2 | Apps Script Web App URL | `js/config.js` | `GOOGLE_SCRIPT_URL` |
| 3 | Google Drive download link | `google-apps-script/Code.gs` | `CONFIG.DRIVE_LINK` |

Plus one secret you paste into Apps Script → Script Properties (never into a file): `RAZORPAY_KEY_SECRET`.

Search the project for `PASTE` — those three lines are the only placeholders.

### Optional display settings (all in `js/config.js`)

| Setting | Default | What it does |
|---|---|---|
| `ORIGINAL_PRICE` | `2499` | Struck-through price shown next to ₹999, plus a "You save ₹1,500" badge. `0` hides both. Display only; the amount charged is always ₹999. |
| `OFFER_TIMER_ENABLED` | `true` | Shows the "Offer ends in" countdown next to the price and above the checkout form |
| `OFFER_TIMER_MINUTES` | `60` | Countdown length. It restarts automatically when it reaches zero (endless loop, remembered per visitor so refreshing continues it). |
| `REVIEWS` | empty | "Our Student Reviews" section. Add `{ name: "…", instrument: "…", text: "…" }` entries. The section stays hidden while the list is empty. |

---

## File structure

```
raag-ebook-website/
├── index.html                  Product page (hero, features, 30 Raag list, preview, FAQ, checkout)
├── success.html                Payment confirmation + Google Drive download page
├── css/
│   ├── style.css               Shared Flute Room design system (from the Alankaar site, unused sections removed)
│   └── ebook.css               Raag page styles (was an inline <style> on the Alankaar page)
├── js/
│   ├── config.js               ★ THE ONLY FRONT-END FILE YOU EDIT
│   ├── common.js               Storage, visitor ID, UTM capture, Apps Script client
│   ├── tracking.js             The ONLY Meta Pixel code on the site
│   ├── ebook.js                Product page + checkout / payment flow
│   └── success.js              Verification, download button, Purchase event
├── policies/
│   ├── terms.html              New, Raag-specific Terms & Conditions
│   ├── refund.html             Alankaar refund policy, product references updated
│   └── privacy.html            Alankaar privacy policy, product + tracking references updated
├── assets/
│   ├── raag-ebook-cover-760.webp / -480.webp / -200.webp   Your cover (background removed, see notes)
│   ├── og-image.jpg            Link-preview image (1200×630)
│   ├── preview/raag-preview-1…4.webp   Real pages (Yaman ×2, Bhupali, Bhairav) for the view-only preview
│   ├── logo.png, upi-qr.png, payment-badges/*   Reused from the Alankaar site
├── google-apps-script/
│   └── Code.gs                 ★ New backend for the Raag product (Drive link lives here)
└── SETUP_GUIDE.md              This file
```

---

## A. Add the Meta Pixel ID

1. Open **`js/config.js`**.
2. Find:
   ```js
   META_PIXEL_ID: "PASTE_YOUR_NEW_META_PIXEL_ID_HERE",
   ```
3. Replace with your ID (numbers only, keep the quotes):
   ```js
   META_PIXEL_ID: "123456789012345",
   ```

That is the only place. Until you do this, the Pixel is switched off and nothing breaks. The old Alankaar Pixel ID is not used anywhere.

For server-side Conversions API (optional, see section E), you also add the same Pixel ID and a CAPI token as Script Properties in Apps Script. That's a separate, secret-only location because the token must never reach the browser.

## B. Add the Google Drive link

1. In Google Drive, right-click the eBook PDF (or folder) → **Share** → General access: **Anyone with the link → Viewer** → **Copy link**.
2. Open **`google-apps-script/Code.gs`** (in the Apps Script editor, after section C).
3. Find:
   ```js
   DRIVE_LINK: 'PASTE_RAAG_GOOGLE_DRIVE_LINK_HERE',
   ```
   and paste your link:
   ```js
   DRIVE_LINK: 'https://drive.google.com/file/d/XXXXXXXX/view?usp=sharing',
   ```
4. **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy.** A code change only goes live after this step.

**Why it's in Code.gs and not `js/config.js`:** every file in `js/` is public. If the link were there, anyone could open `config.js` and download the eBook without paying. The Alankaar site had already moved its link server-side for the same reason. The link is only sent to a browser after the server has confirmed with Razorpay that the payment is captured, ₹999, INR, and for this product. It's still one place to change.

## C. Connect the new Google Sheet

Sheet: `https://docs.google.com/spreadsheets/d/1YIWm2LZyqI_yLYV0VaJufZmZdk8gdKriuW-kS0vEAJ0/edit`. Its ID is already set in `Code.gs` (`CONFIG.SHEET_ID`).

1. **Open the Google Sheet** while logged in as the account that owns it.
2. **Extensions → Apps Script.** A new project opens (it's bound to this sheet, separate from the Alankaar script).
3. **Add the script:** delete the default `myFunction`, paste the whole of `google-apps-script/Code.gs`, and click 💾 Save. Name the project something like "Raag eBook backend".
4. **Configure:**
   - `CONFIG.SHEET_ID` is already your new sheet. `CONFIG.DRIVE_LINK` is covered in section B.
   - ⚙️ **Project Settings → Script Properties → Add script property:**
     - `RAZORPAY_KEY_SECRET` = the **same Key Secret** your Alankaar Apps Script uses. Find it in the Alankaar script's Project Settings → Script Properties, or regenerate it in the Razorpay Dashboard → Account & Settings → API Keys. If you regenerate, you must update the Alankaar script too.
5. **Run `setup`:** pick `setup` in the function dropdown → ▶ Run → **Review permissions** → choose your account → *Advanced → Go to (project) → Allow*. This creates the **Orders** tab with its header row. Permissions requested:
   - *See, edit, create and delete your spreadsheets* — write orders to the sheet
   - *Connect to an external service* — call Razorpay (and Meta CAPI)
   - *Send email as you* — send the download-link email
6. **Run `testRazorpay`** → the log should say `Razorpay credentials OK`.
7. **Deploy as a Web App:** **Deploy → New deployment → ⚙️ Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone** (required so customers' browsers can call it; this does not give anyone access to your sheet)
   - Click **Deploy**.
8. **Copy the Web App URL** (it ends in `/exec`).
9. **Paste it into `js/config.js`:**
   ```js
   GOOGLE_SCRIPT_URL: "https://script.google.com/macros/s/AKfy…/exec",
   ```
10. **Test a submission:** open `YOUR_WEB_APP_URL?action=ping` in a browser → `{"ok":true,"status":"alive"}`. Then on the live site, fill in the form and open Razorpay. A row with status **Checkout Started** should appear in the Orders tab within a few seconds.

**Sheet columns:** Timestamp · Updated At · Attempt ID · Name · Email · Phone · Product · Amount (INR) · Currency · Payment Status · Razorpay Payment ID · Razorpay Order ID · Payment Method · Verified Via · UTM Source · UTM Medium · UTM Campaign · UTM Content · UTM Term · Landing Page · Referrer · fbclid · fbp · fbc · External ID · User Agent · Email Sent · CAPI Sent · Notes

**Payment Status values:** `Checkout Started` → `Paid`. `AMOUNT MISMATCH` rows are flagged and never get access. **Notes** flags `POSSIBLE DUPLICATE …` so you can refund.

**Every time you change `Code.gs`, redeploy:** Deploy → Manage deployments → ✏️ → New version → Deploy. The URL stays the same.

### Razorpay webhook (recommended, a third confirmation path)

Razorpay Dashboard → Account & Settings → **Webhooks** → Add New Webhook:

- URL: your Web App `/exec` URL
- Events: `payment.captured`, `payment.authorized`, `order.paid`
- Secret: anything. Apps Script can't read headers, so the script re-fetches every payment from Razorpay's API instead of trusting the webhook body.

⚠️ If your **Alankaar** script is also registered as a webhook on the same Razorpay account, it will receive Raag payments too. It should ignore them because the product note is `raag-ebook`, not `ebook`, and the amount is different. Check its Sheet after your first live Raag test to confirm no stray row appears there.

## D. Razorpay — what stays and what to check

| Item | Status |
|---|---|
| Razorpay account | **Unchanged** — same account as Alankaar |
| Key ID `rzp_live_Sczvk68iCuryMo` | **Unchanged**, already set in both `js/config.js` and `Code.gs` |
| Key Secret | **Same secret**, copied into the new script's Script Properties |
| Price | ₹999, set **server-side** in `Code.gs` `PRICE_INR` (the order amount) and shown from `js/config.js` `PRODUCT_PRICE`. Keep both at 999. |
| Product note | `raag-ebook`. This is how the server tells Raag payments apart from Alankaar payments on the same account. |
| Dashboard → Settings → **Payment Capture** | Check it's **Automatic** (applies to payments made through orders) |
| Website domain | If Razorpay asks you to whitelist domains for live payments, add the new domain |
| Test mode | To test without real money, temporarily use your `rzp_test_…` key in **both** files and the **test** secret in Script Properties, then switch back |

## E. Meta Pixel testing (Events Manager)

1. Events Manager → your **Pixel (Dataset)** → **Test events** tab.
2. Enter your website URL → **Open website**. Or install the *Meta Pixel Helper* Chrome extension.
3. **PageView:** appears once when the page loads.
4. **ViewContent:** appears once per page load, with `value 999`, `currency INR`, `content_ids ["raag-ebook"]`, `content_type product`.
5. **InitiateCheckout:** fill the form and press **Get Lifetime Access**. It fires once when Razorpay opens. Close Razorpay and press the button again — it must **not** fire a second time (same attempt).
6. **Purchase** (real ₹999 payment, then refund yourself from the Razorpay dashboard, or use test mode):
   - It fires on the success page only after the server confirms the payment.
   - Parameters: `value 999`, `currency INR`, `content_ids`, `order_id`, event ID `raag_purchase_pay_…`.
   - **Refresh** the success page → **no second Purchase**.
7. **Duplicates:** in Test events, each event should show once per action. If you enabled CAPI, Purchase shows as **Browser + Server — Deduplicated**.
8. **Event Match Quality:** Events Manager → Overview → click **Purchase** → *Event match quality*. It takes 24–48 h of real traffic to show a score.
9. **Debug mode:** add `?debug=1` to the URL and open the browser console to see every Pixel call the site makes (`[RaagPixel] …`).

**Matching signals sent**

- Browser Pixel: `em`, `ph` (+91), `fn`, `ln`, `external_id` (a random first-party visitor ID), `country`, plus Meta's own `_fbp`/`_fbc` cookies. The Pixel hashes these itself.
- Server CAPI (Purchase): the same fields SHA-256 hashed in Apps Script, plus `fbp`, `fbc`, `client_user_agent` and the same `event_id`.
- Not sent: `client_ip_address`, because Apps Script can't see the buyer's IP. Nothing is invented. No EMQ score can be guaranteed.

**Enable CAPI (optional):** Events Manager → Dataset → Settings → *Conversions API → Generate access token*. Then in Apps Script → Script Properties add:

- `META_PIXEL_ID` = your Pixel ID
- `META_CAPI_ACCESS_TOKEN` = the token
- (while testing) `META_TEST_EVENT_CODE` = the `TEST…` code from the Test events tab. **Delete it after testing.**

Redeploy. The **CAPI Sent** column shows `Yes …` or the error.

---

## Deployment

### Option 1 — GitHub Pages (how fluteroom.online is hosted: it has a `CNAME` file)

1. Create a new repository, e.g. `raag-ebook`, and upload **everything except** `google-apps-script/` and `SETUP_GUIDE.md`. They're harmless, but they don't need to be public. `index.html` must be at the repository root.
2. Settings → **Pages** → Source: *Deploy from a branch* → `main` / `root` → Save.
3. **Domain:** Settings → Pages → Custom domain → e.g. `raag.fluteroom.online` (this creates the `CNAME` file). At your DNS provider, add a **CNAME** record `raag` → `YOUR-GITHUB-USERNAME.github.io`. For a root domain, use GitHub's four A records instead.
4. Tick **Enforce HTTPS** once it becomes available (can take up to an hour).

### Option 2 — Hostinger

1. hPanel → Websites → your domain → **File Manager** → `public_html` (or a subfolder such as `public_html/raag`).
2. Upload the same files, keeping the folder structure.
3. hPanel → **SSL** → install the free SSL → turn on **Force HTTPS**.
4. Domain: point the domain's nameservers or A record to Hostinger (hPanel shows the values).

### Either way

- **HTTPS is required.** Razorpay live mode, clipboard copy and the Pixel all need it.
- After the domain is live, open `index.html` and change `<meta property="og:image" content="assets/og-image.jpg">` to the full URL, e.g. `https://raag.fluteroom.online/assets/og-image.jpg`, so WhatsApp and Facebook previews show the cover. Optionally set `CONFIG.SITE_URL` in `Code.gs` to the page URL (used by CAPI).
- Add a link to the new page from fluteroom.online's menu if you want.
- Browsers cache JS. After editing `config.js` on a live site, hard-refresh (Ctrl+Shift+R) to see the change.

---

## Testing guide (do this on the live HTTPS site before running ads)

| # | Test | Expected |
|---|---|---|
| 1 | Open the page | Loads fast; cover sharp; no horizontal scroll on phone |
| 2 | Pixel Helper | PageView ×1, ViewContent ×1 |
| 3 | Fill form, tap Pay | Razorpay opens almost instantly; InitiateCheckout ×1; a **Checkout Started** row appears in the sheet |
| 4 | Double / triple tap Pay | Only one Razorpay window |
| 5 | Close Razorpay | "Payment wasn't completed" + **Try Payment Again**; the small "Payment trouble?" button appears |
| 6 | Try again | Same Razorpay order reused (see the Orders tab / dashboard); no second InitiateCheckout |
| 7 | Pay ₹999 (real or test mode) | Redirect to success page → "Payment Successful" → **Download Your eBook** opens your Drive link; Purchase ×1; sheet row becomes **Paid** with Payment ID; email arrives; CAPI Sent = Yes (if enabled) |
| 8 | Refresh success page | Download button still there; **no** second Purchase |
| 9 | Go back to the product page | Banner: "You have already purchased … Open your download page" |
| 10 | Open `success.html?pid=pay_FAKE123456` | "Payment not confirmed", no download link |
| 11 | On a phone: pay by UPI app, then close the Razorpay window before it confirms | "We're checking your payment status. Please don't pay again…", then either the download page or clear next steps |
| 12 | Refund the test payment | Razorpay Dashboard → Payments → Refund |

---

## Final QA report

Automated tests were run on the finished code with Razorpay, Apps Script and Meta mocked. Browser flows used headless Chromium (43/43 checks passed). The Apps Script logic was tested with mocked Google services (27/27 passed).

**Design**

- [x] Same visual system (fonts, colours, buttons, cards, header, footer, WhatsApp float, floating cover animation)
- [x] No redesign
- [x] New cover used
- [x] Mobile responsive: no horizontal scroll at 320, 375, 414, 768, 1024 and 1440 px on every page

**Product**

- [x] 30 Raag, all 30 listed by name in Hindi + English
- [x] ₹999
- [x] Lifetime access
- [x] Handwritten Hindi
- [x] A4 printable
- [x] How to Read section
- [x] Google Drive delivery
- [x] WhatsApp support

**Payment**

- [x] Checkout opens in **3 ms** when the order is ready (normal case)
- [x] **≤1.5 s** worst case when Apps Script is slow
- [x] **18 ms** when Apps Script is down
- [x] Success, failure, cancel, retry and uncertain states handled
- [x] Triple-click opens one checkout
- [x] Retry reuses one Razorpay order
- [x] The browser can never mark a row Paid

**Google Sheet**

- [x] New sheet
- [x] Upsert by Attempt ID (one row per purchase)
- [x] Payment ID recorded
- [x] Formula injection blocked
- [x] Duplicate payments flagged

**Meta**

- [x] ID configurable in one place; old ID removed; `fbq(` exists only in `tracking.js`
- [x] PageView, ViewContent, InitiateCheckout and Purchase each fire once, with value 999 and INR
- [x] Every event has an event_id
- [x] No Purchase on refresh
- [x] No Purchase on a fake payment ID
- [x] CAPI uses the same event_id, and the token stays server-only

**Delivery**

- [x] Drive link only in `Code.gs`
- [x] Link returned only after verification
- [x] Download button works

**Legal**

- [x] Privacy + Refund policies reused with product references updated
- [x] New Terms cover: digital product, lifetime access, Drive delivery, personal use, no redistribution/resale/link sharing, IP, handwritten material, support limits, refunds, technical issues

---

## Remaining risks / things you must do manually

1. Fill in the **3 values** (Pixel ID, Web App URL, Drive link) and the **Razorpay secret** Script Property, then **redeploy** the script.
2. **Cover subtitle mismatch:** the cover says **"का संक्षिप्त परिचय"** (*brief* introduction), while the product name you gave says **"विस्तृत परिचय"** (*detailed*). The website uses your product name. You may want to make these consistent.
3. **Cover background:** the supplied PNG had the grey "transparency" checkerboard baked in as real pixels. Only that background was removed so the book floats cleanly. The cover artwork itself is untouched.
4. **How to Read section:** only three individual Raag PDFs were inspected. Confirm the compiled eBook includes the How to Read section before launch.
5. **Student reviews:** the "Our Student Reviews" section is hidden until you add real reviews to `REVIEWS` in `js/config.js`. Each one shows the text, the name and, below it, the instrument.
6. **Offer price and timer:** India's CCPA *Guidelines for Prevention and Regulation of Dark Patterns, 2023* list "false urgency" as a dark pattern, and consumer law expects a struck-through price to be a genuine earlier price. A timer that restarts forever and a ₹2,499 price the eBook was never sold at could be challenged. Both can be switched off in `config.js`.
7. **Removed from the Alankaar pattern on purpose:**
   - The "Lead" event, which was fired together with InitiateCheckout on the same click.
   - The noscript Pixel image, because it would need a second copy of the Pixel ID.
8. **Order wait cap:** if a customer fills the form faster than Apps Script can create the order (rare, on a cold start), checkout waits at most 1.5 s. After that it opens without an order, and the server captures that payment when it verifies it. Set `ORDER_MAX_WAIT_MS: 0` for zero wait. With 0 there are slightly more order-less payments, which depend on server capture. If all capture paths failed, you'd need to capture the payment manually in the Razorpay dashboard within a few days, otherwise it is auto-refunded.
9. **Email quota:** consumer Gmail can send about 100 emails/day via Apps Script. The download page doesn't depend on email, so this only affects the backup email.
10. **"Anyone with the link" Drive sharing** means a buyer could forward the link. The Terms prohibit it. For stronger control you'd need per-buyer sharing, which isn't built.
11. **Alankaar site:** only `alankaars-ebook.html` was changed (stronger highlight on the floating "Payment failed? — Pay here" button, full text on every phone width). Its Apps Script source wasn't in the zip, so its webhook behaviour couldn't be inspected.
