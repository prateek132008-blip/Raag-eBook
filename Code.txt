/**
 * ==========================================================================
 *  30 RAAG eBOOK — Google Apps Script backend  (Code.gs)
 * ==========================================================================
 *  A NEW, separate script for the Raag product. It does not touch the
 *  30 Alankaar script or sheet.
 *
 *  What it does
 *    • action=lead         Logs "Checkout Started" rows (fire-and-forget from the site)
 *    • action=createOrder  Creates the Razorpay order (price is set HERE, server-side)
 *    • action=status       Asks Razorpay whether an order has been paid (payment recovery)
 *    • action=verify       Verifies a payment with Razorpay, captures it if needed,
 *                          marks the row Paid, emails the Drive link (once), sends the
 *                          Meta CAPI Purchase (once) and returns the Drive link.
 *    • doPost              Razorpay webhook (a third, independent confirmation path)
 *    • reconcile()         Time-driven sweep every 10 min (a fourth path; see installTriggers)
 *
 *  SETUP (full walkthrough in SETUP_GUIDE.md → section C)
 *    1. Fill in the CONFIG block below (DRIVE_LINK at minimum).
 *    2. Project Settings → Script Properties → add:
 *         RAZORPAY_KEY_SECRET      (required — the SAME secret as the Alankaar script)
 *         META_PIXEL_ID            1997808510883821  (server-side CAPI)
 *         META_CAPI_ACCESS_TOKEN   the CAPI token from Events Manager (server-side CAPI)
 *         META_TEST_EVENT_CODE     (optional — only while testing CAPI in Events Manager)
 *    3. Run  setup()  once from the editor (creates the header row + asks for permissions).
 *    4. Run  testRazorpay()  once (checks the key/secret pair).
 *    5. Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone.
 *    6. Paste the /exec URL into js/config.js → GOOGLE_SCRIPT_URL.
 *    7. Run  installTriggers()  once — schedules reconcile(), the safety net that
 *       finds and delivers any paid order the site/webhook missed.
 *
 *  SECRETS: never paste the Razorpay secret or the Meta token into this file —
 *  Script Properties are not visible to anyone who only has the web-app URL.
 * ==========================================================================
 */

/* ============================== CONFIG ============================== */
const CONFIG = {
  // ★ THE ONLY PLACE THE GOOGLE DRIVE LINK LIVES.
  //   It is returned to the browser ONLY after a payment is verified.
  //   Use a "Anyone with the link — Viewer" Google Drive share link.
  DRIVE_LINK: 'https://drive.google.com/drive/folders/1eB8Yi4KIq1J6tqz3zKuPVT1zinPuWS8t?usp=sharing',

  // The NEW Raag Google Sheet (from its URL: /spreadsheets/d/<THIS PART>/edit)
  SHEET_ID: '1YIWm2LZyqI_yLYV0VaJufZmZdk8gdKriuW-kS0vEAJ0',
  SHEET_NAME: 'Orders',                 // tab is created by setup() if missing

  // Product — must match js/config.js
  PRODUCT_ID: 'raag-ebook',
  PRODUCT_NAME: '30 Raag — Detailed Raag Parichay & Notation',
  PRICE_INR: 649,                       // the price actually charged (server-side)
  CURRENCY: 'INR',

  // Razorpay PUBLIC key id (same as js/config.js). Secret → Script Properties.
  RAZORPAY_KEY_ID: 'rzp_live_Sczvk68iCuryMo',

  // Delivery email (sent once per paid order, as a backup to the download page)
  SEND_EMAIL: true,
  BUSINESS_NAME: 'The Flute Room',
  SUPPORT_EMAIL: 'prateek132008@gmail.com',
  WHATSAPP_NUMBER: '918709268496',

  // Meta Conversions API (only used if META_PIXEL_ID + META_CAPI_ACCESS_TOKEN
  // Script Properties are set). Graph API version — update when Meta retires it.
  GRAPH_API_VERSION: 'v25.0',
  // Public URL of the product page, used as event_source_url for CAPI.
  // Leave '' to use the landing page recorded for the order.
  // Required by Meta for website events — rows created by the webhook have no
  // landing page, so without this their CAPI events had no event_source_url.
  SITE_URL: 'https://fluteroom.shop/',

  TIMEZONE: 'Asia/Kolkata'
};

/* Sheet columns (order matters — setup() writes this header row). */
const COLS = [
  'Timestamp', 'Updated At', 'Attempt ID', 'Name', 'Email', 'Phone',
  'Product', 'Amount (INR)', 'Currency', 'Payment Status',
  'Razorpay Payment ID', 'Razorpay Order ID', 'Payment Method', 'Verified Via',
  'UTM Source', 'UTM Medium', 'UTM Campaign', 'UTM Content', 'UTM Term',
  'Landing Page', 'Referrer', 'fbclid', 'fbp', 'fbc', 'External ID', 'User Agent',
  'Email Sent', 'CAPI Sent', 'Notes', 'Client IP'
];
// Payment Status you can type by hand for a sale paid OUTSIDE Razorpay (the
// manual UPI / QR popup, screenshot on WhatsApp). reconcile() then sends it
// to Meta as a Purchase (once). See the "Raag tools" menu in the sheet.
const MANUAL_PAID_STATUS = 'Manual Paid';
const C_ = {}; COLS.forEach(function (n, i) { C_[n] = i + 1; });   // name → 1-based column

/* ============================== ROUTING ============================== */
function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    switch (p.action) {
      case 'lead':        return json_(handleLead_(p));
      case 'createOrder': return json_(handleCreateOrder_(p));
      case 'status':      return json_(handleStatus_(p));
      case 'verify':      return json_(handleVerify_(p));
      case 'ping':        return json_({ ok: true, status: 'alive' });
      default:            return json_({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    console.error('doGet ' + p.action + ' failed: ' + (err && err.stack || err));
    return json_({ ok: false, error: 'server_error' });
  }
}

/** Razorpay webhook. Apps Script cannot read request headers, so the
 *  X-Razorpay-Signature can't be checked here. Instead the payload is treated
 *  only as a HINT: the payment is re-fetched from Razorpay's API with our
 *  secret, so a forged webhook can't mark anything paid. */
function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const ev = String(body.event || '');
    const pay = body.payload && body.payload.payment && body.payload.payment.entity;
    if (pay && /^pay_/.test(pay.id || '') && /payment\.(captured|authorized)|order\.paid/.test(ev)) {
      const fresh = rzp_('get', '/payments/' + pay.id);
      if (fresh.ok) processPayment_(fresh.body, 'webhook', {});
    }
  } catch (err) {
    console.error('webhook error: ' + (err && err.stack || err));
  }
  return json_({ ok: true });
}

/* ============================== HANDLERS ============================== */

/** Pre-payment log (never marks anything Paid). One row per Attempt ID. */
function handleLead_(p) {
  const attemptId = cleanAttempt_(p.attemptId);
  if (!attemptId) return { ok: false, error: 'bad_attempt' };
  if (throttled_('lead', 60)) return { ok: false, error: 'busy' };   // spam guard (logging only)
  const email = String(p.email || '').trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, error: 'bad_email' };

  const fields = {
    'Attempt ID': attemptId,
    'Name': clip_(p.name, 100), 'Email': clip_(email, 120), 'Phone': clip_(String(p.phone || '').replace(/[^\d+ ]/g, ''), 20),
    'Product': CONFIG.PRODUCT_ID, 'Amount (INR)': CONFIG.PRICE_INR, 'Currency': CONFIG.CURRENCY,
    'Razorpay Order ID': /^order_[A-Za-z0-9]{6,40}$/.test(p.rzpOrderId || '') ? p.rzpOrderId : '',
    'UTM Source': clip_(p.utm_source, 150), 'UTM Medium': clip_(p.utm_medium, 150), 'UTM Campaign': clip_(p.utm_campaign, 200),
    'UTM Content': clip_(p.utm_content, 200), 'UTM Term': clip_(p.utm_term, 150),
    'Landing Page': clip_(p.landing_page, 500), 'Referrer': clip_(p.referrer, 300), 'fbclid': clip_(p.fbclid, 300),
    'fbp': clip_(p.fbp, 200), 'fbc': clip_(p.fbc, 400), 'External ID': clip_(p.external_id, 60), 'User Agent': clip_(p.user_agent, 300),
    'Client IP': cleanIp_(p.ip)
  };

  const out = withLock_(function () {
    const sh = sheet_();
    const row = findRow_(sh, 'Attempt ID', attemptId);
    if (row) {
      const cur = readRow_(sh, row);
      const upd = {};
      Object.keys(fields).forEach(function (k) {
        // Customer details may be corrected on a retry; attribution keeps the first value.
        const editable = ['Name', 'Email', 'Phone', 'Razorpay Order ID'].indexOf(k) !== -1;
        if (fields[k] !== '' && (editable || cur[k] === '' || cur[k] === null)) upd[k] = fields[k];
      });
      if (cur['Payment Status'] !== 'Paid') upd['Payment Status'] = 'Checkout Started';
      writeRow_(sh, row, upd);
    } else {
      fields['Timestamp'] = now_();
      fields['Payment Status'] = 'Checkout Started';
      appendRow_(sh, fields);
    }
    return { ok: true };
  });

  // Server-side InitiateCheckout, same event_id as the browser
  // ("raag_ic_<attemptId>") so Meta deduplicates. Once per attempt.
  try {
    const cache = CacheService.getScriptCache();
    if (capiConfigured_() && !cache.get('ic_' + attemptId)) {
      cache.put('ic_' + attemptId, '1', 21600);
      const r = sendCapi_('InitiateCheckout', 'raag_ic_' + attemptId, Math.floor(Date.now() / 1000), {
        name: fields['Name'], email: email, phone: fields['Phone'], 'External ID': fields['External ID'],
        fbp: fields['fbp'], fbc: fields['fbc'], 'User Agent': fields['User Agent'], 'Client IP': fields['Client IP'],
        'Landing Page': fields['Landing Page']
      }, { num_items: 1 });
      if (!/^Yes/.test(r)) console.warn('CAPI InitiateCheckout: ' + r);
    }
  } catch (e) { console.error('CAPI IC error: ' + e); }
  return out;
}

/** Creates (once per attempt) the Razorpay order. Price comes from CONFIG,
 *  never from the browser. */
function handleCreateOrder_(p) {
  const attemptId = cleanAttempt_(p.attemptId);
  if (!attemptId) return { ok: false, error: 'bad_attempt' };
  const cache = CacheService.getScriptCache();
  // The price is part of the cache key: after a price change, an order cached
  // at the OLD amount (kept up to 6 h) can never be handed out again.
  const key = 'ord_' + CONFIG.PRICE_INR + '_' + attemptId;
  const hit = cache.get(key);
  if (hit) return { ok: true, rzpOrderId: hit, attemptId: attemptId, amount: CONFIG.PRICE_INR * 100 };
  // Spam guard: a flood of fake attempt IDs can't burn the Razorpay / UrlFetch
  // quota. If tripped, the site simply opens checkout without an order (still
  // verified + captured server-side), so real buyers are never blocked.
  if (throttled_('order', 60)) return { ok: false, error: 'busy' };

  return withLock_(function () {
    const again = cache.get(key);
    if (again) return { ok: true, rzpOrderId: again, attemptId: attemptId, amount: CONFIG.PRICE_INR * 100 };
    const res = rzp_('post', '/orders', {
      amount: CONFIG.PRICE_INR * 100,
      currency: CONFIG.CURRENCY,
      receipt: attemptId.slice(0, 40),
      payment_capture: 1,
      notes: { product: CONFIG.PRODUCT_ID, attempt_id: attemptId }
    });
    if (!res.ok || !res.body.id) {
      console.error('createOrder failed: ' + JSON.stringify(res.body));
      return { ok: false, error: 'razorpay_error' };
    }
    cache.put(key, res.body.id, 21600);                   // 6 h
    cache.put('ordprod_' + res.body.id, attemptId, 21600);
    const sh = sheet_();
    const row = findRow_(sh, 'Attempt ID', attemptId);
    if (row) writeRow_(sh, row, { 'Razorpay Order ID': res.body.id });
    return { ok: true, rzpOrderId: res.body.id, attemptId: attemptId, amount: CONFIG.PRICE_INR * 100 };
  });
}

/** Has this attempt been paid? Used by the site's recovery checks.
 *  Looks at the Razorpay order's payments AND (because a checkout can open
 *  without an order when order creation was slow) at recent payments carrying
 *  this attempt ID in their notes.
 *  Returns status: paid | pending | failed | none */
function handleStatus_(p) {
  const orderId = String(p.rzpOrderId || '');
  const attemptId = cleanAttempt_(p.attemptId);
  const hasOrder = /^order_[A-Za-z0-9]{6,40}$/.test(orderId);
  if (!hasOrder && !attemptId) return { ok: false, error: 'bad_order' };

  let items = [];
  if (hasOrder) {
    const res = rzp_('get', '/orders/' + orderId + '/payments');
    if (!res.ok) return { ok: false, error: 'razorpay_error' };
    items = (res.body && res.body.items) || [];
  }
  if (attemptId && !items.some(function (x) { return x.status === 'captured' || x.status === 'authorized'; })) {
    const recent = recentPayments_(3 * 3600);
    if (recent === null && !hasOrder) return { ok: false, error: 'razorpay_error' };
    (recent || []).forEach(function (x) {
      if (x.notes && String(x.notes.attempt_id || '').toUpperCase() === attemptId &&
          !items.some(function (y) { return y.id === x.id; })) items.push(x);
    });
  }
  if (!items.length) return { ok: true, status: 'none' };

  const good = items.filter(function (x) { return x.status === 'captured' || x.status === 'authorized'; })[0];
  if (good) {
    const r = processPayment_(good, 'status', { attemptId: attemptId });
    if (r.status === 'paid') return { ok: true, status: 'paid', paymentId: good.id };
    return { ok: true, status: r.status === 'authorized' ? 'pending' : r.status };
  }
  const pending = items.some(function (x) { return x.status === 'created'; });
  return { ok: true, status: pending ? 'pending' : 'failed' };
}

/** Verifies one payment and (only if paid) returns the Drive link. */
function handleVerify_(p) {
  const paymentId = String(p.paymentId || '');
  if (!/^pay_[A-Za-z0-9]{6,40}$/.test(paymentId)) return { ok: false, error: 'bad_payment' };

  const reqAttempt = cleanAttempt_(p.attemptId);
  const cache = CacheService.getScriptCache();
  const cached = cache.get('paid_' + paymentId);
  if (cached) return paidResponse_(JSON.parse(cached), reqAttempt);

  const res = rzp_('get', '/payments/' + paymentId);
  if (res.code === 400 || res.code === 404) return { ok: true, status: 'not_found' };
  if (!res.ok) return { ok: false, error: 'razorpay_error' };
  const r = processPayment_(res.body, 'verify', { attemptId: cleanAttempt_(p.attemptId) });
  if (r.status === 'paid') return paidResponse_(r.info, reqAttempt);
  return { ok: true, status: r.status };
}

/** Buyer name / email / phone are returned only to the browser that made the
 *  purchase (it knows the random attempt ID). Anyone else who merely has the
 *  payment ID (e.g. from a shared screenshot) gets a masked email only. */
function paidResponse_(info, reqAttempt) {
  const owner = !!reqAttempt && !!info.attemptId && reqAttempt === info.attemptId;
  return {
    ok: true, status: 'paid',
    driveLink: driveLinkConfigured_() ? CONFIG.DRIVE_LINK : null,
    name: owner ? (info.name || '') : '', email: owner ? (info.email || '') : '', phone: owner ? (info.phone || '') : '',
    emailHint: maskEmail_(info.email),
    amount: CONFIG.PRICE_INR, attemptId: owner ? info.attemptId : '', emailSent: !!info.emailSent
  };
}
function maskEmail_(e) {
  const m = String(e || '').match(/^([^@]{0,2})[^@]*(@.+)$/);
  return m ? m[1] + '•••' + m[2] : '';
}

/* ============================== CORE: PROCESS A PAYMENT ==============================
 * Idempotent: can be called any number of times for the same payment (verify from
 * the checkout page, verify from the success page, status polls, webhook) and it
 * results in ONE Paid row, ONE email and ONE CAPI event.
 */
function processPayment_(pay, via, hint) {
  hint = hint || {};
  const notes = pay.notes || {};

  // 1. Is this OUR product? (Same Razorpay account also sells other products.)
  let ours = notes.product === CONFIG.PRODUCT_ID ||
    (pay.order_id && CacheService.getScriptCache().get('ordprod_' + pay.order_id));
  if (!ours && pay.order_id) {
    const ord = rzp_('get', '/orders/' + pay.order_id);
    ours = ord.ok && ord.body.notes && ord.body.notes.product === CONFIG.PRODUCT_ID;
    if (ours && !notes.attempt_id && ord.body.notes.attempt_id) notes.attempt_id = ord.body.notes.attempt_id;
  }
  if (!ours) return { status: 'wrong_product' };

  // 2. Right amount / currency?
  if (Number(pay.amount) !== CONFIG.PRICE_INR * 100 || pay.currency !== CONFIG.CURRENCY) {
    logMismatch_(pay, via);
    return { status: 'amount_mismatch' };
  }

  // 3. Status — capture if only authorised (e.g. an order-less fallback payment).
  if (pay.status === 'authorized') {
    const cap = rzp_('post', '/payments/' + pay.id + '/capture', { amount: pay.amount, currency: pay.currency });
    if (cap.ok && cap.body.status === 'captured') pay = cap.body;
    else {
      const re = rzp_('get', '/payments/' + pay.id);       // maybe captured concurrently
      if (re.ok) pay = re.body;
    }
  }
  if (pay.status === 'refunded' || pay.refund_status === 'full') return { status: 'refunded' };
  if (pay.status === 'failed') return { status: 'failed' };
  if (pay.status !== 'captured') return { status: pay.status === 'authorized' ? 'authorized' : 'pending' };

  // 4. Record it (under a lock so parallel calls can't create two rows).
  const attemptId = cleanAttempt_(notes.attempt_id) || hint.attemptId || '';
  const phone = String(pay.contact || '').replace(/[^\d+]/g, '');
  const email = String(pay.email || '').trim().toLowerCase();
  let info, doEmail = false, doCapi = false, row;

  withLock_(function () {
    const sh = sheet_();
    row = findRow_(sh, 'Razorpay Payment ID', pay.id);
    let note = '';
    if (!row && attemptId) {
      const r = findRow_(sh, 'Attempt ID', attemptId);
      if (r) {
        const cur = readRow_(sh, r);
        if (cur['Payment Status'] === 'Paid' && cur['Razorpay Payment ID'] && cur['Razorpay Payment ID'] !== pay.id) {
          note = 'POSSIBLE DUPLICATE PAYMENT — same attempt already paid by ' + cur['Razorpay Payment ID'] + '. Check & refund if needed.';
        } else row = r;
      }
    }
    if (!row && pay.order_id) {
      const r2 = findRow_(sh, 'Razorpay Order ID', pay.order_id);
      if (r2 && !readRow_(sh, r2)['Razorpay Payment ID']) row = r2;
    }
    if (!note && email) note = recentPaidByEmail_(sh, email, pay.id, row);

    const upd = {
      'Updated At': now_(), 'Payment Status': 'Paid', 'Razorpay Payment ID': pay.id,
      'Razorpay Order ID': pay.order_id || '', 'Payment Method': clip_(pay.method, 30),
      'Amount (INR)': pay.amount / 100, 'Currency': pay.currency, 'Product': CONFIG.PRODUCT_ID
    };
    if (row) {
      const cur = readRow_(sh, row);
      if (!cur['Verified Via']) upd['Verified Via'] = via;
      if (!cur['Name'] && notes.customer_name) upd['Name'] = clip_(notes.customer_name, 100);
      if (!cur['Email'] && email) upd['Email'] = email;
      if (!cur['Phone'] && phone) upd['Phone'] = phone;
      if (!cur['Attempt ID'] && attemptId) upd['Attempt ID'] = attemptId;
      // The browser's "lead" log sometimes never arrives (slow Apps Script,
      // in-app browsers). Fill any missing matching data from the Razorpay
      // payment notes so the CAPI Purchase still carries fbp/fbc/IP/UA.
      [['External ID', notes.external_id, 60], ['fbp', notes.fbp, 200], ['fbc', notes.fbc, 400],
       ['User Agent', notes.user_agent, 300], ['Client IP', cleanIp_(notes.ip), 45],
       ['UTM Source', notes.utm_source, 150], ['UTM Medium', notes.utm_medium, 150], ['UTM Campaign', notes.utm_campaign, 200],
       ['Landing Page', notes.page_url, 500]].forEach(function (f) {
        if (!cur[f[0]] && f[1]) upd[f[0]] = clip_(f[1], f[2]);
      });
      if (note && String(cur['Notes']).indexOf(note) === -1) upd['Notes'] = (cur['Notes'] ? cur['Notes'] + ' | ' : '') + note;
      writeRow_(sh, row, upd);
    } else {
      upd['Timestamp'] = now_(); upd['Attempt ID'] = attemptId; upd['Verified Via'] = via;
      upd['Name'] = clip_(notes.customer_name, 100); upd['Email'] = email; upd['Phone'] = phone;
      upd['External ID'] = clip_(notes.external_id, 60); upd['fbp'] = clip_(notes.fbp, 200); upd['fbc'] = clip_(notes.fbc, 400);
      upd['UTM Source'] = clip_(notes.utm_source, 150); upd['UTM Medium'] = clip_(notes.utm_medium, 150);
      upd['UTM Campaign'] = clip_(notes.utm_campaign, 200); upd['User Agent'] = clip_(notes.user_agent, 300);
      upd['Client IP'] = cleanIp_(notes.ip); upd['Landing Page'] = clip_(notes.page_url, 500);
      upd['Notes'] = note;
      row = appendRow_(sh, upd);
    }

    // Claim the one-time side effects inside the lock.
    const cur = readRow_(sh, row);
    doEmail = CONFIG.SEND_EMAIL && driveLinkConfigured_() && claimable_(cur['Email Sent']) && !!(cur['Email'] || email);
    doCapi = capiConfigured_() && claimable_(cur['CAPI Sent']);
    const claim = {};
    if (doEmail) claim['Email Sent'] = 'Sending… ' + now_();
    if (doCapi) claim['CAPI Sent'] = 'Sending… ' + now_();
    if (doEmail || doCapi) writeRow_(sh, row, claim);
    info = {
      name: cur['Name'] || notes.customer_name || '', email: cur['Email'] || email, phone: cur['Phone'] || phone,
      attemptId: cur['Attempt ID'] || attemptId, emailSent: /^Yes/.test(String(cur['Email Sent'])), row: cur
    };
  });

  // 5. One-time side effects, outside the lock.
  const sh = sheet_();
  if (doEmail) {
    const r = sendDeliveryEmail_(info, pay);
    writeRow_(sh, row, { 'Email Sent': r });
    info.emailSent = /^Yes/.test(r);
  }
  if (doCapi) writeRow_(sh, row, { 'CAPI Sent': sendCapiPurchase_(info, pay) });

  const slim = { name: info.name, email: info.email, phone: info.phone, attemptId: info.attemptId, emailSent: info.emailSent };
  CacheService.getScriptCache().put('paid_' + pay.id, JSON.stringify(slim), 21600);
  return { status: 'paid', info: slim };
}

/** Empty, a previous failure, or a stale "Sending…" (>5 min) can be (re)tried. */
function claimable_(v) {
  v = String(v || '');
  if (!v || /^Failed/.test(v)) return true;
  const m = v.match(/^Sending… (.+)$/);
  if (m) { const t = new Date(m[1].replace(' ', 'T') + '+05:30').getTime(); return !isNaN(t) && Date.now() - t > 5 * 60 * 1000; }
  return false;
}

/** Flags a second Paid row for the same email in the last 24 h. */
function recentPaidByEmail_(sh, email, paymentId, ownRow) {
  const last = sh.getLastRow();
  if (last < 2) return '';
  const data = sh.getRange(2, 1, last - 1, COLS.length).getValues();
  for (let i = data.length - 1; i >= 0 && i >= data.length - 400; i--) {
    const r = data[i];
    if (i + 2 === ownRow) continue;
    if (String(r[C_['Email'] - 1]).toLowerCase() === email && r[C_['Payment Status'] - 1] === 'Paid' &&
        r[C_['Razorpay Payment ID'] - 1] && r[C_['Razorpay Payment ID'] - 1] !== paymentId) {
      const t = toMs_(r[C_['Updated At'] - 1] || r[0]);
      if (!isNaN(t) && Date.now() - t < 24 * 3600 * 1000)
        return 'POSSIBLE DUPLICATE PURCHASE — same email also paid ' + r[C_['Razorpay Payment ID'] - 1] + ' within 24 h. Check & refund if needed.';
    }
  }
  return '';
}

/** A sheet cell can come back as a Date (Sheets auto-parses our timestamps) or a string. */
function toMs_(v) {
  if (v instanceof Date) return v.getTime();
  return new Date(String(v || '').replace(' ', 'T') + '+05:30').getTime();
}

function logMismatch_(pay, via) {
  try {
    withLock_(function () {
      const sh = sheet_();
      if (findRow_(sh, 'Razorpay Payment ID', pay.id)) return;
      appendRow_(sh, {
        'Timestamp': now_(), 'Updated At': now_(), 'Payment Status': 'AMOUNT MISMATCH', 'Razorpay Payment ID': pay.id,
        'Razorpay Order ID': pay.order_id || '', 'Amount (INR)': Number(pay.amount) / 100, 'Currency': pay.currency,
        'Email': pay.email || '', 'Phone': pay.contact || '', 'Verified Via': via, 'Product': CONFIG.PRODUCT_ID,
        'Notes': 'Paid amount does not match the product price — access NOT granted. Review manually.'
      });
    });
  } catch (e) { console.error(e); }
}

/* ============================== EMAIL ============================== */
function sendDeliveryEmail_(info, pay) {
  try {
    if (MailApp.getRemainingDailyQuota() < 1) return 'Failed: daily email quota reached';
    const name = String(info.name || '').split(' ')[0] || 'there';
    const esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    const html =
      '<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111">' +
      '<h2 style="color:#8E1B1B">Your 30 Raag eBook is ready 🎉</h2>' +
      '<p>Hi ' + esc(name) + ',</p>' +
      '<p>Thank you for purchasing <b>' + esc(CONFIG.PRODUCT_NAME) + '</b> (Raag Sangrah — Bandish, Aaroh–Avroh, Pakad &amp; Taan in English Sargam Notation). Your payment is confirmed.</p>' +
      '<p style="margin:26px 0"><a href="' + esc(CONFIG.DRIVE_LINK) + '" style="background:#8E1B1B;color:#fff;padding:14px 22px;border-radius:100px;text-decoration:none;font-weight:bold">Download Your eBook (Google Drive)</a></p>' +
      '<p>Tip: download a copy to your device. Start with the <b>How to Read the Notation</b> page.</p>' +
      '<p style="font-size:13px;color:#555">Payment ID: ' + esc(pay.id) + (info.attemptId ? '<br>Reference: ' + esc(info.attemptId) : '') + '</p>' +
      '<p style="font-size:13px;color:#555">This eBook is licensed for your personal use only — please don\'t share the link or the file.</p>' +
      '<p style="font-size:13px;color:#555">Payment or download problem? WhatsApp us: <a href="https://wa.me/' + CONFIG.WHATSAPP_NUMBER + '">+' + CONFIG.WHATSAPP_NUMBER + '</a></p>' +
      '<p>— ' + esc(CONFIG.BUSINESS_NAME) + '</p></div>';
    MailApp.sendEmail({
      to: info.email, subject: 'Your 30 Raag eBook — download link', htmlBody: html,
      name: CONFIG.BUSINESS_NAME, replyTo: CONFIG.SUPPORT_EMAIL
    });
    return 'Yes ' + now_();
  } catch (e) {
    console.error('email failed: ' + e);
    return 'Failed: ' + String(e).slice(0, 120);
  }
}

/* ============================== META CONVERSIONS API ==============================
 * Server-side InitiateCheckout + Purchase (and manual UPI sales) with the SAME
 * event_id as the browser Pixel
 * ("raag_purchase_<payment_id>"), so Meta deduplicates them into one purchase.
 * All personal data is normalised + SHA-256 hashed here before sending.
 * Apps Script can't see the buyer's IP, so the site looks it up and passes it
 * along (Razorpay notes "ip" / lead param "ip"); sent as client_ip_address.
 */
function capiConfigured_() {
  const pr = PropertiesService.getScriptProperties();
  return /^\d{6,20}$/.test(pr.getProperty('META_PIXEL_ID') || '') && !!pr.getProperty('META_CAPI_ACCESS_TOKEN');
}
function sendCapiPurchase_(info, pay) {
  const cur = info.row || {};
  const notes = pay.notes || {};
  const src = {
    name: info.name, email: info.email, phone: info.phone,
    'External ID': cur['External ID'] || notes.external_id, fbp: cur['fbp'] || notes.fbp, fbc: cur['fbc'] || notes.fbc,
    'User Agent': cur['User Agent'] || notes.user_agent, 'Client IP': cur['Client IP'] || cleanIp_(notes.ip),
    'Landing Page': cur['Landing Page'] || notes.page_url
  };
  return sendCapi_('Purchase', 'raag_purchase_' + pay.id, capiTime_(pay.created_at), src, {
    value: pay.amount / 100, num_items: 1, order_id: info.attemptId || pay.order_id || pay.id
  });
}

/** Builds hashed user_data from a row-like object (sheet column names). */
function capiUserData_(r) {
  const nameParts = String(r.name || r['Name'] || '').trim().toLowerCase().split(/\s+/).filter(String);
  const digits = String(r.phone || r['Phone'] || '').replace(/\D/g, '');
  const ph = digits.length === 10 ? '91' + digits : (digits.length === 11 && digits[0] === '0' ? '91' + digits.slice(1) : digits);
  const email = String(r.email || r['Email'] || '').trim().toLowerCase();
  const ud = { country: [sha256_('in')] };
  if (email) ud.em = [sha256_(email)];
  if (ph.length >= 10) ud.ph = [sha256_(ph)];
  if (nameParts[0]) ud.fn = [sha256_(nameParts[0])];
  if (nameParts.length > 1) ud.ln = [sha256_(nameParts[nameParts.length - 1])];
  if (r['External ID']) ud.external_id = [sha256_(String(r['External ID']))];
  if (r.fbp) ud.fbp = String(r.fbp);
  if (r.fbc) ud.fbc = String(r.fbc);
  if (r['User Agent']) ud.client_user_agent = String(r['User Agent']);
  if (cleanIp_(r['Client IP'])) ud.client_ip_address = cleanIp_(r['Client IP']);
  return ud;
}

/** Sends ONE server event to Meta. Returns 'Yes …' or 'Failed: …' (for the sheet). */
function sendCapi_(eventName, eventId, eventTime, src, extraCustom) {
  try {
    const pr = PropertiesService.getScriptProperties();
    const custom = {
      currency: CONFIG.CURRENCY, value: CONFIG.PRICE_INR,
      content_ids: [CONFIG.PRODUCT_ID], content_type: 'product', content_name: CONFIG.PRODUCT_NAME,
      contents: [{ id: CONFIG.PRODUCT_ID, quantity: 1, item_price: CONFIG.PRICE_INR }]
    };
    Object.keys(extraCustom || {}).forEach(function (k) { custom[k] = extraCustom[k]; });
    const lp = String(src['Landing Page'] || '');
    const payload = {
      data: [{
        event_name: eventName,
        event_time: eventTime,
        event_id: eventId,
        action_source: 'website',
        event_source_url: CONFIG.SITE_URL || (/^https:\/\//.test(lp) ? lp.split('?')[0] : ''),
        user_data: capiUserData_(src),
        custom_data: custom
      }]
    };
    const test = pr.getProperty('META_TEST_EVENT_CODE');
    if (test) payload.test_event_code = test;
    const url = 'https://graph.facebook.com/' + CONFIG.GRAPH_API_VERSION + '/' + pr.getProperty('META_PIXEL_ID') +
      '/events?access_token=' + encodeURIComponent(pr.getProperty('META_CAPI_ACCESS_TOKEN'));
    const res = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true });
    if (res.getResponseCode() === 200) return 'Yes ' + now_() + (test ? ' (test)' : '');
    return 'Failed: ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 150);
  } catch (e) {
    return 'Failed: ' + String(e).slice(0, 150);
  }
}
function capiTime_(createdAt) {
  const nowS = Math.floor(Date.now() / 1000);
  const t = Number(createdAt) || nowS;
  return nowS - t > 6 * 86400 ? nowS : Math.min(t, nowS);   // Meta rejects events > 7 days old
}
function sha256_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

/* ============================== RAZORPAY API ============================== */
function rzp_(method, path, body) {
  const secret = PropertiesService.getScriptProperties().getProperty('RAZORPAY_KEY_SECRET');
  if (!secret) throw new Error('RAZORPAY_KEY_SECRET script property is not set');
  const opts = {
    method: method, muteHttpExceptions: true,
    headers: { Authorization: 'Basic ' + Utilities.base64Encode(CONFIG.RAZORPAY_KEY_ID + ':' + secret) }
  };
  if (body) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(body); }
  const res = UrlFetchApp.fetch('https://api.razorpay.com/v1' + path, opts);
  const code = res.getResponseCode();
  let parsed = {};
  try { parsed = JSON.parse(res.getContentText() || '{}'); } catch (e) {}
  return { ok: code >= 200 && code < 300, code: code, body: parsed };
}

/* ============================== SHEET HELPERS ============================== */
function sheet_() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  let sh = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sh) { sh = ss.insertSheet(CONFIG.SHEET_NAME); writeHeader_(sh); }
  else if (sh.getRange(1, COLS.length).getValue() !== COLS[COLS.length - 1]) writeHeader_(sh);   // new column added
  return sh;
}
function writeHeader_(sh) {
  sh.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold').setBackground('#F6ECDD');
  sh.setFrozenRows(1);
}
function findRow_(sh, colName, value) {
  if (!value) return 0;
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const cell = sh.getRange(2, C_[colName], last - 1, 1).createTextFinder(String(value)).matchEntireCell(true).matchCase(true).findNext();
  return cell ? cell.getRow() : 0;
}
function readRow_(sh, row) {
  const v = sh.getRange(row, 1, 1, COLS.length).getValues()[0];
  const o = {}; COLS.forEach(function (n, i) { o[n] = v[i]; });
  return o;
}
function writeRow_(sh, row, obj) {
  obj['Updated At'] = obj['Updated At'] || now_();
  Object.keys(obj).forEach(function (k) {
    if (C_[k]) sh.getRange(row, C_[k]).setValue(safe_(obj[k]));
  });
}
function appendRow_(sh, obj) {
  obj['Updated At'] = obj['Updated At'] || now_();
  const row = COLS.map(function (n) { return obj[n] === undefined || obj[n] === null ? '' : safe_(obj[n]); });
  sh.appendRow(row);
  return sh.getLastRow();
}

/** Recent payments on the Razorpay account (newest first), or null on API error. */
function recentPayments_(seconds) {
  const from = Math.floor(Date.now() / 1000) - seconds;
  const out = [];
  for (let skip = 0; skip < 500; skip += 100) {
    const r = rzp_('get', '/payments?from=' + from + '&count=100&skip=' + skip);
    if (!r.ok) return skip ? out : null;
    const items = (r.body && r.body.items) || [];
    Array.prototype.push.apply(out, items);
    if (items.length < 100) break;
  }
  return out;
}

/* ============================== SAFETY NET: RECONCILE ==============================
 * Runs every 10 minutes (install once with installTriggers()). It asks Razorpay
 * for the last 3 days of payments and processes every Raag payment that is
 * captured or authorized but not yet marked Paid in the sheet. This catches:
 *   • buyers who closed the browser before the success page loaded,
 *   • webhook deliveries that failed,
 *   • order-less (fallback) payments that were only AUTHORIZED — these are
 *     captured here, long before Razorpay's automatic refund of uncaptured
 *     payments, and the buyer still gets the download email.
 * processPayment_ is idempotent, so running it on an already-Paid payment
 * changes nothing and never sends a second email.
 */
function reconcile() {
  const items = recentPayments_(3 * 86400);
  if (!items) { console.error('reconcile: Razorpay API error'); return; }
  const sh = sheet_();
  const capiOn = capiConfigured_();
  let done = 0;
  items.forEach(function (pay) {
    if (pay.status !== 'captured' && pay.status !== 'authorized') return;
    if (Number(pay.amount) !== CONFIG.PRICE_INR * 100) return;          // cheap pre-filter
    const row = findRow_(sh, 'Razorpay Payment ID', pay.id);
    if (row) {
      const cur = readRow_(sh, row);
      const emailOk = !CONFIG.SEND_EMAIL || !driveLinkConfigured_() || !cur['Email'] || /^Yes/.test(String(cur['Email Sent']));
      const capiOk = !capiOn || !claimable_(cur['CAPI Sent']);            // CAPI sent (or not configured)
      if (cur['Payment Status'] === 'Paid' && emailOk && capiOk) return;  // fully handled
      if (cur['Payment Status'] === 'AMOUNT MISMATCH') return;
    }
    try {
      const r = processPayment_(pay, 'reconcile', {});
      if (r.status === 'paid') done++;
    } catch (e) { console.error('reconcile ' + pay.id + ': ' + e); }
  });
  console.log('reconcile: checked ' + items.length + ' payments, processed ' + done);
  try { sendManualSales(); } catch (e) { console.error('manual sales: ' + e); }
}

/* ============================== MANUAL (UPI / QR) SALES → META ==============================
 * Sales paid through the "Payment trouble?" popup never touch Razorpay, so
 * Meta never heard about them. To count one:
 *   1. Find the buyer's row (search the Attempt ref from their WhatsApp
 *      message, or their email), or add a new row with Name, Email, Phone.
 *   2. Type  Manual Paid  in the Payment Status column.
 * Within 10 minutes (or via the menu: Raag tools → Send manual sales to Meta)
 * it is sent as a Purchase. The CAPI Sent column shows the result. Meta only
 * accepts events up to 7 days old, so mark them soon after the payment.
 */
function sendManualSales() {
  if (!capiConfigured_()) { console.log('CAPI not configured — skipping manual sales'); return 0; }
  const sh = sheet_();
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const data = sh.getRange(2, 1, last - 1, COLS.length).getValues();
  let sent = 0;
  data.forEach(function (v, i) {
    const r = {}; COLS.forEach(function (n, j) { r[n] = v[j]; });
    if (String(r['Payment Status']).trim().toLowerCase() !== MANUAL_PAID_STATUS.toLowerCase()) return;
    if (!claimable_(r['CAPI Sent'])) return;
    if (!r['Email'] && !r['Phone']) { writeRow_(sh, i + 2, { 'CAPI Sent': 'Failed: add Email or Phone first' }); return; }
    const row = i + 2;
    let ref = cleanAttempt_(r['Attempt ID']);
    if (!ref) { ref = 'RAAG-MANUAL-' + row + '-' + Utilities.getUuid().slice(0, 8).toUpperCase(); writeRow_(sh, row, { 'Attempt ID': ref }); }
    const amount = Number(r['Amount (INR)']) || CONFIG.PRICE_INR;
    const res = sendCapi_('Purchase', 'raag_manual_' + ref, Math.floor(Date.now() / 1000),
      { name: r['Name'], email: r['Email'], phone: r['Phone'], 'External ID': r['External ID'], fbp: r['fbp'], fbc: r['fbc'],
        'User Agent': r['User Agent'], 'Client IP': r['Client IP'], 'Landing Page': r['Landing Page'] },
      { value: amount, num_items: 1, order_id: ref });
    writeRow_(sh, row, { 'CAPI Sent': res, 'Verified Via': r['Verified Via'] || 'manual' });
    if (/^Yes/.test(res)) sent++;
  });
  console.log('manual sales sent to Meta: ' + sent);
  return sent;
}

/* ============================== ONE-TIME BACKFILL ==============================
 * Sends a CAPI Purchase for every Paid row whose "CAPI Sent" is empty (all
 * sales made before CAPI was switched on), if the payment is < 7 days old
 * (Meta's limit). Uses the same event_id as the browser Pixel, so purchases
 * Meta already saw are deduplicated, and only the missing ones get added.
 * Run once from the editor after adding the Script Properties.
 */
function backfillCapi() {
  if (!capiConfigured_()) { console.log('Add META_PIXEL_ID and META_CAPI_ACCESS_TOKEN Script Properties first.'); return; }
  const sh = sheet_();
  const last = sh.getLastRow();
  if (last < 2) return;
  const data = sh.getRange(2, 1, last - 1, COLS.length).getValues();
  data.forEach(function (v, i) {
    const r = {}; COLS.forEach(function (n, j) { r[n] = v[j]; });
    if (r['Payment Status'] !== 'Paid' || !/^pay_/.test(String(r['Razorpay Payment ID'])) || !claimable_(r['CAPI Sent'])) return;
    const pay = rzp_('get', '/payments/' + r['Razorpay Payment ID']);
    if (!pay.ok) { console.log(r['Razorpay Payment ID'] + ': Razorpay error'); return; }
    if (Date.now() / 1000 - Number(pay.body.created_at) > 7 * 86400 - 3600) {
      writeRow_(sh, i + 2, { 'CAPI Sent': 'Skipped: older than 7 days (Meta limit)' });
      return;
    }
    const res = sendCapiPurchase_({ name: r['Name'], email: r['Email'], phone: r['Phone'], attemptId: r['Attempt ID'], row: r }, pay.body);
    writeRow_(sh, i + 2, { 'CAPI Sent': res });
    console.log(r['Razorpay Payment ID'] + ' → ' + res);
  });
}

/* Run once: sends ONE test PageView. First copy the TEST… code from Events Manager →
 * your dataset → Test events, and add it as the META_TEST_EVENT_CODE Script Property.
 * Delete that property again when you've finished testing. */
function testCapi() {
  const pr = PropertiesService.getScriptProperties();
  console.log('CAPI configured: ' + capiConfigured_());
  if (!capiConfigured_()) return;
  if (!pr.getProperty('META_TEST_EVENT_CODE')) { console.log('Add META_TEST_EVENT_CODE first so this does not count as real traffic.'); return; }
  console.log(sendCapi_('PageView', 'raag_test_' + Date.now(), Math.floor(Date.now() / 1000),
    { email: 'test@example.com', 'User Agent': 'Mozilla/5.0 (CAPI test)' }, {}));
}

/** Adds a "Raag tools" menu to the sheet. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Raag tools')
    .addItem('Send manual sales to Meta', 'sendManualSales')
    .addItem('Run payment check now (reconcile)', 'reconcile')
    .addToUi();
}

/** Run ONCE from the editor: schedules reconcile() every 10 minutes. */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'reconcile') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('reconcile').timeBased().everyMinutes(10).create();
  console.log('reconcile() will now run every 10 minutes.');
}

/* ============================== UTILITIES ============================== */
/** Simple global rate limit: true once more than `perMin` calls of `name` hit this minute. */
function throttled_(name, perMin) {
  try {
    const c = CacheService.getScriptCache();
    const k = 'rl_' + name + '_' + Math.floor(Date.now() / 60000);
    const n = Number(c.get(k) || 0) + 1;
    c.put(k, String(n), 120);
    return n > perMin;
  } catch (e) { return false; }
}
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('busy');
  try { return fn(); } finally { lock.releaseLock(); }
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function now_() { return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss'); }
function clip_(v, n) { return String(v === undefined || v === null ? '' : v).trim().slice(0, n); }
function cleanIp_(v) { v = String(v || '').trim(); return /^[0-9a-fA-F:.]{7,45}$/.test(v) ? v : ''; }
function cleanAttempt_(v) { v = String(v || '').trim().toUpperCase(); return /^RAAG-[A-Z0-9-]{6,48}$/.test(v) ? v : ''; }
/** Stops spreadsheet formula injection (a value starting with = + - @ is stored as text). */
function safe_(v) { return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v; }
function driveLinkConfigured_() { return /^https:\/\/(drive|docs)\.google\.com\//.test(CONFIG.DRIVE_LINK); }

/* ============================== RUN-ONCE / TEST FUNCTIONS ============================== */
/** Run once from the editor: creates the Orders tab + header and triggers the permission prompt. */
function setup() {
  const sh = sheet_();
  if (sh.getLastRow() === 0 || sh.getRange(1, 1).getValue() !== COLS[0]) writeHeader_(sh);
  console.log('Sheet ready: ' + sh.getParent().getUrl());
  console.log('Drive link configured: ' + driveLinkConfigured_());
  console.log('Razorpay secret set: ' + !!PropertiesService.getScriptProperties().getProperty('RAZORPAY_KEY_SECRET'));
  console.log('Meta CAPI configured: ' + capiConfigured_());
  MailApp.getRemainingDailyQuota();   // makes sure the email permission is granted too
  UrlFetchApp.fetch('https://api.razorpay.com', { muteHttpExceptions: true }); // and external requests
}
/** Run once: checks the Razorpay key id + secret pair (reads 1 order, changes nothing). */
function testRazorpay() {
  const r = rzp_('get', '/orders?count=1');
  console.log(r.ok ? 'Razorpay credentials OK' : 'Razorpay error ' + r.code + ': ' + JSON.stringify(r.body));
}