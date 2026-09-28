/* ==========================================================================
   30 RAAG eBOOK — ebook.js  (product page: index.html)
   Same structure as the Alankaar page's js/ebook.js, with the payment flow
   re-audited:

   PAYMENT ARCHITECTURE — "one user action → one checkout → one result"
   ----------------------------------------------------------------------
   1. Buying intent (tap on a Buy button, form scrolled into view, or focus
      in the form) → the Razorpay ORDER is created in the background via
      Apps Script. Nothing waits for it.
   2. Submit → validate locally → lock the button → Pixel InitiateCheckout
      (non-blocking) → Sheet "Checkout Started" log (fire-and-forget)
      → OPEN RAZORPAY. If the background order is ready it is used; if it is
      still in flight we wait at most CONFIG.ORDER_MAX_WAIT_MS (default 1.5 s)
      and then open anyway without an order. Google Sheets / Apps Script /
      the Pixel can never stop or noticeably delay the payment window.
   3. The attempt (ID + Razorpay order) is saved and REUSED for retries, so a
      failed-then-successful purchase is one order and one Sheet row, and a
      second checkout can never be opened while one is open.
   4. Result:
        success   → one exit point, completePurchase() → success.html
        failed    → "Payment wasn't completed" + Try Payment Again
        closed    → "Payment wasn't completed" + Try Payment Again
        unknown   → (customer left for a UPI app, then closed the window)
                    "We're checking your payment status. Please don't pay
                    again…" while we ask Razorpay (via Apps Script) whether
                    the order was paid. Retry is disabled during the check.
      Page reload / app kill mid-payment → on the next load the saved order
      is checked and a paid customer is taken to their download page.
   5. Delivery + Purchase event happen on success.html only after the
      payment is verified with Razorpay by the server.
   ========================================================================== */
document.addEventListener("DOMContentLoaded", function () {
  "use strict";
  var C = window.CONFIG, U = window.RaagUtil, T = window.RaagTrack;
  var PRICE = C.PRODUCT_PRICE;

  /* ============ BASIC PAGE UI (same behaviour as the Alankaar page) ============ */
  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();
  document.querySelectorAll("[data-price]").forEach(function (el) { el.textContent = U.rupees(PRICE); });

  var drawer = document.getElementById("mobileDrawer");
  var navToggle = document.getElementById("navToggle");
  var drawerClose = document.getElementById("drawerClose");
  if (navToggle && drawer) navToggle.addEventListener("click", function () { drawer.classList.add("open"); });
  if (drawerClose && drawer) drawerClose.addEventListener("click", function () { drawer.classList.remove("open"); });
  if (drawer) drawer.querySelectorAll("a").forEach(function (a) { a.addEventListener("click", function () { drawer.classList.remove("open"); }); });

  var header = document.getElementById("siteHeader");
  if (header) window.addEventListener("scroll", function () { header.classList.toggle("scrolled", window.scrollY > 12); }, { passive: true });

  var revealEls = document.querySelectorAll(".reveal, .reveal-stagger");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add("is-visible"); io.unobserve(en.target); } });
    }, { threshold: 0.12 });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add("is-visible"); });
  }

  /* ---- Struck-through original price + "You save" (display only) ---- */
  var ORIGINAL = Number(C.ORIGINAL_PRICE) || 0;
  if (ORIGINAL > PRICE) {
    document.querySelectorAll("[data-original-price]").forEach(function (el) { el.textContent = U.rupees(ORIGINAL); });
    document.querySelectorAll("[data-save-badge]").forEach(function (el) { el.textContent = "You save " + U.rupees(ORIGINAL - PRICE); });
  } else {
    document.querySelectorAll("[data-original-price], [data-save-badge]").forEach(function (el) { el.remove(); });
  }

  /* ---- Offer countdown: OFFER_TIMER_MINUTES, then restarts (endless loop).
     The end time is remembered per visitor so a refresh continues the count
     instead of starting again. Purely visual — never touches checkout. ---- */
  (function offerTimer() {
    var els = document.querySelectorAll("[data-offer-timer]");
    if (!C.OFFER_TIMER_ENABLED || !els.length) return;
    var DURATION = Math.max(1, Number(C.OFFER_TIMER_MINUTES) || 60) * 60000;
    var KEY = "raag_offer_end";
    var end = parseInt(U.sget("localStorage", KEY), 10);
    function reset() { end = Date.now() + DURATION; U.sset("localStorage", KEY, String(end)); }
    if (!end || isNaN(end) || end <= Date.now() || end - Date.now() > DURATION) reset();
    var outs = document.querySelectorAll("[data-offer-time]");
    function pad(n) { return n < 10 ? "0" + n : String(n); }
    function tick() {
      var left = end - Date.now();
      if (left <= 0) { reset(); left = DURATION; }
      var t = Math.floor(left / 1000), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
      var txt = (h ? pad(h) + ":" : "") + pad(m) + ":" + pad(sec);
      outs.forEach(function (o) { o.textContent = txt; });
    }
    els.forEach(function (el) { el.hidden = false; });
    tick(); setInterval(tick, 1000);
  })();

  /* ---- "Our Student Reviews" — rendered from CONFIG.REVIEWS (real reviews
     only). Hidden, with its menu links, while the list is empty. ---- */
  (function reviews() {
    var list = (C.REVIEWS || []).filter(function (r) { return r && r.name && r.text; });
    var section = document.getElementById("reviews"), grid = document.getElementById("reviewGrid");
    if (!section || !grid) return;
    if (!list.length) {
      section.remove();
      document.querySelectorAll('a[href="#reviews"]').forEach(function (a) { a.remove(); });
      return;
    }
    list.forEach(function (r) {
      var card = document.createElement("div"); card.className = "review-card";
      var stars = document.createElement("div"); stars.className = "stars"; stars.setAttribute("aria-hidden", "true");
      var n = Math.max(1, Math.min(5, Number(r.stars) || 5)); stars.textContent = "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n);
      var q = document.createElement("p"); q.textContent = "“" + String(r.text).trim() + "”";
      if (/[\u0900-\u097F]{6,}/.test(r.text) && !/[a-z]{4,}\s+[a-z]{4,}\s+[a-z]{4,}/i.test(r.text.replace(/eBook|reference|material/gi, ""))) q.lang = "hi";
      var person = document.createElement("div"); person.className = "review-person";
      var av = document.createElement("div"); av.className = "review-avatar"; av.textContent = String(r.name).trim().charAt(0).toUpperCase();
      var who = document.createElement("div");
      var nm = document.createElement("div"); nm.className = "review-name"; nm.textContent = r.name;
      var ins = document.createElement("div"); ins.className = "review-loc"; ins.textContent = r.instrument || "";
      who.appendChild(nm); who.appendChild(ins); person.appendChild(av); person.appendChild(who);
      card.appendChild(stars); card.appendChild(q); card.appendChild(person); grid.appendChild(card);
    });
    grid.classList.add("reveal-stagger");
    section.hidden = false;
    if ("IntersectionObserver" in window) {
      var rio = new IntersectionObserver(function (e) { if (e[0].isIntersecting) { grid.classList.add("is-visible"); rio.disconnect(); } }, { threshold: 0.1 });
      rio.observe(grid);
    } else grid.classList.add("is-visible");
  })();

  /* ---- CTA flourish: sargam syllables, notes and tiny instruments rise from
     behind the main buttons and fade out. Decorative only (aria-hidden,
     pointer-events: none), paused while the button is busy, and switched
     off for visitors who prefer reduced motion. ---- */
  (function ctaNotes() {
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    var GLYPHS = ["सा", "रे", "ग", "म", "प", "ध", "नि", "♪", "♫", "🪈", "🎹", "🪕", "🎸", "🥁"];
    document.querySelectorAll(".cta-wrap").forEach(function (wrap, wi) {
      var layer = document.createElement("span"); layer.className = "cta-notes"; layer.setAttribute("aria-hidden", "true");
      wrap.insertBefore(layer, wrap.firstChild);
      var button = wrap.querySelector(".btn-cta");
      var i = wi * 3;
      function spawn() {
        if (document.hidden || (button && button.disabled)) return;
        var r = wrap.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) return;         // off-screen: skip
        var g = GLYPHS[i++ % GLYPHS.length];
        var n = document.createElement("span");
        n.className = "cta-note" + (/[\u0900-\u097F]/.test(g) ? " hi" : "");
        n.textContent = g;
        n.style.left = (10 + Math.random() * 72) + "%";
        n.style.setProperty("--dx", (Math.random() * 28 - 14).toFixed(0) + "px");
        n.style.setProperty("--rot", (Math.random() * 30 - 15).toFixed(0) + "deg");
        n.style.animationDuration = (2.6 + Math.random() * 1.2).toFixed(2) + "s";
        layer.appendChild(n);
        setTimeout(function () { n.remove(); }, 4200);
      }
      setInterval(spawn, 650);
    });
  })();

  /* FAQ accordion (same as the main site) */
  document.querySelectorAll(".faq-item").forEach(function (item) {
    var q = item.querySelector(".faq-q"), a = item.querySelector(".faq-a");
    q.addEventListener("click", function () {
      var isOpen = item.classList.contains("open");
      document.querySelectorAll(".faq-item.open").forEach(function (o) {
        o.classList.remove("open"); o.querySelector(".faq-a").style.maxHeight = null; o.querySelector(".faq-q").setAttribute("aria-expanded", "false");
      });
      if (!isOpen) { item.classList.add("open"); a.style.maxHeight = a.scrollHeight + "px"; q.setAttribute("aria-expanded", "true"); }
    });
  });

  /* View-only preview (pages rendered from the real eBook as images; the PDF
     itself is never linked). Right-click/drag disabled + CSS watermark —
     casual-copy deterrents only. */
  var previews = [
    { src: "assets/preview/raag-preview-1.webp", cap: "Raag Yaman — page 1 · Parichay, Pakad & Bandish" },
    { src: "assets/preview/raag-preview-2.webp", cap: "Raag Yaman — page 2 · Antara & Taans" },
    { src: "assets/preview/raag-preview-3.webp", cap: "Raag Bhupali — page 1" },
    { src: "assets/preview/raag-preview-4.webp", cap: "Raag Bhairav — page 1" }
  ];
  var pIdx = 0;
  var pImg = document.getElementById("previewImg"), pCap = document.getElementById("previewCaption"),
      pCount = document.getElementById("previewCounter"), pPrev = document.getElementById("previewPrev"), pNext = document.getElementById("previewNext");
  function renderPreview() {
    if (!pImg) return;
    pImg.src = previews[pIdx].src;
    pImg.alt = "Handwritten sample page from the 30 Raag eBook: " + previews[pIdx].cap;
    if (pCap) pCap.textContent = previews[pIdx].cap;
    if (pCount) pCount.textContent = (pIdx + 1) + " / " + previews.length;
    if (pPrev) pPrev.disabled = pIdx === 0;
    if (pNext) pNext.disabled = pIdx === previews.length - 1;
    var nxt = previews[pIdx + 1]; if (nxt) { var pre = new Image(); pre.src = nxt.src; }
  }
  if (pImg) {
    pImg.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    pImg.addEventListener("dragstart", function (e) { e.preventDefault(); });
    if (pPrev) pPrev.addEventListener("click", function () { if (pIdx > 0) { pIdx--; renderPreview(); } });
    if (pNext) pNext.addEventListener("click", function () { if (pIdx < previews.length - 1) { pIdx++; renderPreview(); } });
    renderPreview();
  }

  function waLink(text) { return "https://wa.me/" + C.WHATSAPP_NUMBER + "?text=" + encodeURIComponent(text); }
  var supportFloat = document.getElementById("supportFloat");
  if (supportFloat) supportFloat.addEventListener("click", function () {
    window.open(waLink("Hi, I have a question about the 30 Raag eBook (payment / access / download)."), "_blank", "noopener");
  });

  /* ============ META PIXEL: PageView + ViewContent (once each) ============ */
  try { T.start(); T.viewContent(); } catch (e) { /* tracking must never break the page */ }

  /* ============ CHECKOUT ============ */
  var form = document.getElementById("checkoutForm");
  var btn = document.getElementById("checkoutBtn");
  var stateBox = document.getElementById("payState");
  if (!form || !btn) return;

  var ATTEMPT_KEY = "raag_attempt";
  var SUCCESS_KEY = "raag_success";
  var ATTEMPT_MAX_AGE = 24 * 3600 * 1000;
  var BTN_LABEL = "Get Lifetime Access — " + U.rupees(PRICE);

  var phase = "idle";          // idle | starting | open | checking | done
  var completed = false;
  var rzp = null;
  var failedThisOpen = null;   // Razorpay error object of the current open, if any
  var lastData = null;

  /* ---- attempt persistence ---- */
  function newAttemptId() { return ("RAAG-" + Date.now().toString(36) + "-" + U.randomId(8)).toUpperCase(); }
  function loadAttempt() {
    var a = U.jget("localStorage", ATTEMPT_KEY);
    if (a && a.attemptId && Date.now() - (a.createdAt || 0) < ATTEMPT_MAX_AGE) return a;
    return null;
  }
  var attempt = loadAttempt();
  function saveAttempt() { if (attempt) U.jset("localStorage", ATTEMPT_KEY, attempt); }
  function getAttempt() {
    if (!attempt) { attempt = { attemptId: newAttemptId(), createdAt: Date.now() }; saveAttempt(); }
    return attempt;
  }

  /* ---- UI helpers ---- */
  function setBusy(text) {
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    btn.innerHTML = '<span class="spinner" aria-hidden="true"></span><span></span>';
    btn.lastChild.textContent = text;
  }
  function resetButton(label) {
    btn.disabled = false;
    btn.removeAttribute("aria-busy");
    btn.textContent = label || BTN_LABEL;
  }
  function showError(field, msg) { var el = form.querySelector('[data-error-for="' + field + '"]'); if (el) el.textContent = msg || ""; }
  function hideState() { stateBox.className = "pay-state"; stateBox.textContent = ""; }
  /* kind: info | error | checking | ok ; actions: [{label, cls, onClick | href}] */
  function showState(kind, title, body, actions) {
    stateBox.className = "pay-state show " + kind;
    stateBox.setAttribute("role", kind === "error" ? "alert" : "status");
    stateBox.textContent = "";
    var t = document.createElement("strong"); t.textContent = title; stateBox.appendChild(t);
    if (body) { var p = document.createElement("span"); p.textContent = body; stateBox.appendChild(p); }
    if (actions && actions.length) {
      var row = document.createElement("div"); row.className = "pay-state-actions";
      actions.forEach(function (a) {
        var el = document.createElement(a.href ? "a" : "button");
        el.className = "btn " + (a.cls || "btn-primary");
        el.textContent = a.label;
        if (a.href) { el.href = a.href; el.target = "_blank"; el.rel = "noopener"; } else { el.type = "button"; el.addEventListener("click", a.onClick); }
        row.appendChild(el);
      });
      stateBox.appendChild(row);
    }
  }
  function scrollToForm() {
    var t = document.getElementById("buy");
    try { t.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (e) { t.scrollIntoView(); }
  }
  var tryAgainAction = { label: "Try Payment Again", cls: "btn-primary", onClick: function () { retry(); } };
  function supportAction(reason) {
    var a = attempt || {}, d = lastData || {};
    return { label: "WhatsApp Support", cls: "btn-outline", href: waLink(
      "Hi, I need help with my 30 Raag eBook payment (" + reason + ").\nName: " + (d.fullName || "") +
      "\nEmail: " + (d.email || "") + "\nPhone: " + (d.whatsapp || "") + "\nAttempt ref: " + (a.attemptId || "")) };
  }

  function readForm() {
    return {
      fullName: String(form.fullName.value || "").trim().replace(/\s+/g, " "),
      email: String(form.email.value || "").trim(),
      whatsapp: String(form.whatsapp.value || "").trim()
    };
  }
  function validate(d) {
    var ok = true;
    ["fullName", "email", "whatsapp"].forEach(function (f) { showError(f, ""); });
    if (d.fullName.length < 2) { showError("fullName", "Please enter your full name."); ok = false; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) { showError("email", "Please enter a valid email address."); ok = false; }
    var digits = d.whatsapp.replace(/\D/g, "");
    if (!(digits.length === 10 || (digits.length === 12 && digits.indexOf("91") === 0) || (digits.length === 11 && digits[0] === "0")) || !/^[6-9]/.test(U.phone10(digits))) {
      showError("whatsapp", "Please enter a valid 10-digit Indian mobile number."); ok = false;
    }
    return ok;
  }

  /* ---- Razorpay order (background) ---- */
  var orderPromise = null;
  function ensureOrder() {
    var a = getAttempt();
    if (a.rzpOrderId) return Promise.resolve(a);
    if (orderPromise) return orderPromise;
    orderPromise = U.gasCall({ action: "createOrder", attemptId: a.attemptId }, 15000)
      .then(function (res) {
        if (!res || !res.ok || !/^order_/.test(res.rzpOrderId || "")) throw new Error("createOrder: " + JSON.stringify(res));
        if (attempt === a) { a.rzpOrderId = res.rzpOrderId; saveAttempt(); }
        return a;
      })
      .finally(function () { orderPromise = null; });
    return orderPromise;
  }
  function prefetchOrder() {
    if (completed || !U.isConfigured(C.GOOGLE_SCRIPT_URL)) return;
    ensureOrder().catch(function (e) { if (U.debug) console.warn("Order prefetch failed (checkout still works):", e); });
  }
  // Buying-intent signals → create the order early (each fires at most once).
  form.addEventListener("focusin", prefetchOrder, { once: true });
  document.querySelectorAll('a[href="#buy"]').forEach(function (a) { a.addEventListener("click", prefetchOrder, { once: true }); });
  if ("IntersectionObserver" in window) {
    var buyIo = new IntersectionObserver(function (en) { if (en[0].isIntersecting) { prefetchOrder(); buyIo.disconnect(); } }, { rootMargin: "300px 0px" });
    buyIo.observe(document.getElementById("buy"));
  }

  /* ---- Razorpay script (loaded with defer in the page; reload once if it failed) ---- */
  var rzpScriptPromise = null;
  function loadRazorpay() {
    if (typeof window.Razorpay === "function") return Promise.resolve(true);
    if (rzpScriptPromise) return rzpScriptPromise;
    rzpScriptPromise = new Promise(function (resolve) {
      var done = false, finish = function (ok) { if (!done) { done = true; resolve(ok); } };
      var t = setTimeout(function () { finish(typeof window.Razorpay === "function"); }, 8000);
      var s = document.createElement("script");
      s.src = "https://checkout.razorpay.com/v1/checkout.js"; s.async = true;
      s.onload = function () { clearTimeout(t); finish(typeof window.Razorpay === "function"); };
      s.onerror = function () { clearTimeout(t); finish(false); };
      document.head.appendChild(s);
    }).then(function (ok) { if (!ok) rzpScriptPromise = null; return ok; });
    return rzpScriptPromise;
  }

  /* ---- Sheet log (fire-and-forget, never awaited) ---- */
  function logCheckoutStarted(a, d) {
    var attr = U.getAttribution();
    U.gasFire({
      action: "lead",
      attemptId: a.attemptId,
      rzpOrderId: a.rzpOrderId || "",
      name: d.fullName, email: d.email, phone: d.whatsapp,
      product: C.PRODUCT_ID, amount: PRICE,
      utm_source: attr.utm_source || "", utm_medium: attr.utm_medium || "", utm_campaign: attr.utm_campaign || "",
      utm_content: attr.utm_content || "", utm_term: attr.utm_term || "",
      landing_page: attr.landing_page || "", referrer: attr.referrer || "", fbclid: attr.fbclid || "",
      fbp: U.getFbp(), fbc: U.getFbc(), external_id: U.visitorId,
      user_agent: (navigator.userAgent || "").slice(0, 300),
      page: window.location.href.slice(0, 300)
    });
  }

  /* ============ SUBMIT — the ONE entry point into payment ============ */
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (phase !== "idle" || completed) return;          // double-click / double-submit guard
    var d = readForm();
    if (!validate(d)) { showState("error", "Please check the highlighted fields.", ""); return; }
    if (navigator.onLine === false) {
      showState("error", "You appear to be offline.", "Please check your internet connection and try again.");
      return;
    }
    phase = "starting";
    lastData = d;
    hideState();
    setBusy("Opening secure payment…");

    var a = getAttempt();
    a.customer = d;
    saveAttempt();

    try { T.setUser(d); T.initiateCheckout(a.attemptId); } catch (err) { /* never blocks checkout */ }
    logCheckoutStarted(a, d);

    var wait = Math.max(0, Number(C.ORDER_MAX_WAIT_MS) || 0);
    var orderReady = a.rzpOrderId || !U.isConfigured(C.GOOGLE_SCRIPT_URL) || wait === 0
      ? Promise.resolve()
      : Promise.race([ensureOrder(), new Promise(function (r) { setTimeout(r, wait); })]).catch(function () {});
    var scriptReady = loadRazorpay();

    Promise.all([orderReady, scriptReady]).then(function (r) {
      if (!r[1]) {
        phase = "idle"; resetButton();
        showState("error", "The payment window couldn't load.",
          "Please check your internet connection and try again. Nothing has been charged.", [tryAgainAction, supportAction("payment window did not load")]);
        revealHelpFloat();
        return;
      }
      openCheckout(d, a);
    });
  });

  function openCheckout(d, a) {
    var attr = U.getAttribution();
    var p10 = U.phone10(d.whatsapp);
    failedThisOpen = null;
    var options = {
      key: C.RAZORPAY_KEY_ID,
      amount: PRICE * 100,               // paise; the server-side order uses the same server-side price
      currency: C.CURRENCY,
      name: C.BUSINESS_NAME,
      description: "30 Raag eBook — Lifetime Access",
      image: new URL(C.BUSINESS_LOGO, window.location.href).href,   // absolute — Razorpay loads it from its own domain
      prefill: { name: d.fullName, email: d.email, contact: "+91" + p10 },
      notes: {                           // max 15 keys × 256 chars (Razorpay limit)
        product: C.PRODUCT_ID,
        attempt_id: a.attemptId,
        customer_name: d.fullName.slice(0, 100),
        external_id: U.visitorId,
        fbp: String(U.getFbp()).slice(0, 250),
        fbc: String(U.getFbc()).slice(0, 250),
        utm_source: String(attr.utm_source || "").slice(0, 120),
        utm_medium: String(attr.utm_medium || "").slice(0, 120),
        utm_campaign: String(attr.utm_campaign || "").slice(0, 200),
        user_agent: String(navigator.userAgent || "").slice(0, 250)
      },
      theme: { color: "#8E1B1B" },
      retry: { enabled: true },
      handler: function (resp) {
        completePurchase({ paymentId: resp.razorpay_payment_id, rzpOrderId: resp.razorpay_order_id || a.rzpOrderId || "" }, "handler");
      },
      modal: {
        confirm_close: true,             // "Are you sure?" before closing mid-payment
        ondismiss: function () { onDismiss(a); }
      }
    };
    if (a.rzpOrderId) options.order_id = a.rzpOrderId;

    try {
      stopPoll();
      rzp = new window.Razorpay(options);
      rzp.on("payment.failed", function (resp) {
        // Razorpay keeps its window open so the customer can pick another
        // method on the SAME order. We only remember it for the close message.
        failedThisOpen = (resp && resp.error) || {};
      });
      rzp.open();
      phase = "open";
      a.opened = true; a.openedAt = Date.now(); a.appSwitch = false;
      saveAttempt();
      resetButton("Payment window open…"); btn.disabled = true;
    } catch (err) {
      phase = "idle"; resetButton();
      showState("error", "The payment window couldn't open.", "Please try again. Nothing has been charged.", [tryAgainAction, supportAction("payment window did not open")]);
      revealHelpFloat();
    }
  }

  function onDismiss(a) {
    if (completed) return;
    rzp = null;
    var uncertain = a.appSwitch || (failedThisOpen && /pending|timeout/i.test((failedThisOpen.reason || "") + (failedThisOpen.code || "")));
    revealHelpFloat();
    if (uncertain && a.rzpOrderId && U.isConfigured(C.GOOGLE_SCRIPT_URL)) {
      beginStatusCheck(a);
      return;
    }
    phase = "idle"; resetButton();
    if (uncertain) {
      showState("checking", "Did you complete the payment in your UPI app?",
        "If money was debited, please don't pay again — message us on WhatsApp and we'll confirm it and send your eBook. If you didn't pay, you can safely try again.",
        [supportAction("paid in UPI app, status unclear"), tryAgainAction]);
    } else if (failedThisOpen) {
      showState("error", "Payment wasn't completed.",
        (failedThisOpen.description ? failedThisOpen.description + " " : "") + "You can try again — the same order is reused, so you won't be charged twice for one purchase.",
        [tryAgainAction, supportAction("payment failed")]);
    } else {
      showState("info", "Payment wasn't completed.", "You closed the payment window. You can try again whenever you're ready.", [tryAgainAction]);
    }
  }

  /* ---- "We're checking your payment status" ---- */
  function beginStatusCheck(a) {
    phase = "checking";
    setBusy("Checking payment status…");
    showState("checking", "We're checking your payment status.",
      "Please don't pay again until the status is confirmed. This usually takes less than a minute.");
    startPoll(a, 4000, 90000, function () {
      // Not confirmed within 90 s: unlock, but keep checking quietly.
      phase = "idle"; resetButton();
      showState("checking", "We couldn't confirm a payment for this attempt yet.",
        "If money was debited from your account, please don't pay again — message us on WhatsApp with your details and we'll confirm it. If you didn't complete the payment, you can try again.",
        [supportAction("status unconfirmed"), { label: "Try Payment Again", cls: "btn-outline", onClick: function () { retry(); } }]);
      startPoll(a, 15000, 10 * 60000, null);
    }, function (status) {
      phase = "idle"; resetButton();
      if (status === "none") {
        showState("info", "Payment wasn't completed.", "No payment was started for this attempt. You can try again whenever you're ready.", [tryAgainAction]);
      } else {
        showState("error", "Payment wasn't completed.",
          "Razorpay reports this payment attempt as failed. If money was debited, banks normally reverse it automatically — or message us and we'll help. You can try again.",
          [tryAgainAction, supportAction("payment failed after UPI app")]);
      }
      // keep a quiet watch in case of a late bank confirmation
      startPoll(a, 20000, 5 * 60000, null);
    });
  }

  var pollTimer = null, pollToken = 0;
  function stopPoll() { pollToken++; if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; } }
  /* onDefinite(status) is called when Razorpay says the order has no payment
     at all ("none") or only failed ones ("failed") — no need to keep the
     customer waiting in those cases. */
  function startPoll(a, every, maxMs, onGiveUp, onDefinite) {
    if (!a || !a.rzpOrderId || completed) return;
    stopPoll();
    var token = pollToken, started = Date.now();
    (function tick() {
      if (token !== pollToken || completed) return;
      U.gasCall({ action: "status", rzpOrderId: a.rzpOrderId, attemptId: a.attemptId }, 15000)
        .then(function (res) {
          if (token !== pollToken || completed) return;
          if (res && res.ok && res.status === "paid" && res.paymentId) {
            completePurchase({ paymentId: res.paymentId, rzpOrderId: a.rzpOrderId }, "recovered");
          } else if (res && res.ok && onDefinite && (res.status === "none" || res.status === "failed")) {
            stopPoll(); onDefinite(res.status);
          }
        })
        .catch(function () { /* transient — keep trying */ })
        .then(function () {
          if (token !== pollToken || completed) return;
          if (Date.now() - started < maxMs) pollTimer = setTimeout(tick, every);
          else if (onGiveUp) onGiveUp();
        });
    })();
  }

  // Registered ONCE. Leaving the page while Razorpay is open = customer went
  // to a UPI/bank app; coming back = check in parallel with Razorpay's own
  // "processing" screen.
  document.addEventListener("visibilitychange", function () {
    if (phase !== "open" || !attempt) return;
    if (document.visibilityState === "hidden") { attempt.appSwitch = true; saveAttempt(); }
    else if (attempt.rzpOrderId) startPoll(attempt, 4000, 180000, null);
  });

  function retry() {
    if (phase !== "idle" || completed) return;
    hideRecovery();
    var d = readForm();
    if (!validate(d)) { scrollToForm(); showState("error", "Please enter your details to continue.", ""); return; }
    if (typeof form.requestSubmit === "function") form.requestSubmit();
    else form.dispatchEvent(new Event("submit", { cancelable: true }));
  }

  /* ============ SINGLE EXIT POINT → success page ============ */
  function completePurchase(info, via) {
    if (completed || !info || !/^pay_/.test(info.paymentId || "")) return;
    completed = true; phase = "done";
    stopPoll(); hideRecovery();
    if (via !== "handler") { try { if (rzp) rzp.close(); } catch (e) {} }
    setBusy("Payment received — opening your download page…");
    showState("ok", "Payment received.", "Taking you to your download page…");

    var a = attempt || {};
    var payload = {
      paymentId: info.paymentId, rzpOrderId: info.rzpOrderId || a.rzpOrderId || "",
      attemptId: a.attemptId || "", customer: a.customer || lastData || {}, via: via, ts: Date.now()
    };
    U.jset("sessionStorage", SUCCESS_KEY, payload);
    U.jset("localStorage", SUCCESS_KEY, payload);
    U.sremove("localStorage", ATTEMPT_KEY);           // paid attempt is never reused

    // Early server verification (captures the payment, records it, emails the
    // link, sends CAPI). keepalive so it survives the redirect. The success
    // page verifies again and the webhook is a third path — none of them
    // delay this redirect.
    U.gasFire({ action: "verify", paymentId: info.paymentId, attemptId: payload.attemptId, rzpOrderId: payload.rzpOrderId });

    window.location.replace("success.html?pid=" + encodeURIComponent(info.paymentId) +
      (payload.attemptId ? "&ref=" + encodeURIComponent(payload.attemptId) : ""));
  }

  /* ============ RETURNING VISITOR SAFETY ============ */
  var banner = document.getElementById("recoveryBanner");
  // (a) Already bought recently on this device → offer the download page
  //     instead of letting them pay a second time by accident.
  var prev = U.jget("localStorage", SUCCESS_KEY);
  if (prev && prev.paymentId && Date.now() - (prev.ts || 0) < 30 * 24 * 3600 * 1000 && banner) {
    banner.innerHTML = 'You have already purchased this eBook on this device. <a href="success.html?pid=' +
      encodeURIComponent(prev.paymentId) + '" style="font-weight:700;text-decoration:underline;">Open your download page →</a>';
    banner.classList.add("show");
    setTimeout(function () { banner.classList.remove("show"); }, 12000);
  }
  // (b) Page was reloaded / the browser was killed while a payment was open
  //     (common when a phone switches to a UPI app). Ask Razorpay whether that
  //     order got paid; if so, go straight to the download page.
  if (attempt && attempt.opened && attempt.rzpOrderId && Date.now() - (attempt.openedAt || 0) < 3 * 3600 * 1000 && U.isConfigured(C.GOOGLE_SCRIPT_URL)) {
    if (banner && !banner.classList.contains("show")) {
      banner.textContent = "Checking the status of your previous payment attempt…";
      banner.classList.add("show");
    }
    var firstAttempt = attempt;
    startPoll(firstAttempt, 5000, 20000, function () { if (banner && !completed) banner.classList.remove("show"); });
  }

  /* ============ STICKY MOBILE CTA — hidden while the form is on screen ============ */
  var sticky = document.getElementById("stickyCta");
  if (sticky && "IntersectionObserver" in window) {
    var sIo = new IntersectionObserver(function (en) {
      en.forEach(function (x) { if (x.target.id === "buy") sticky.classList.toggle("is-hidden", x.isIntersecting); });
    }, { threshold: 0.05 });
    sIo.observe(document.getElementById("buy"));
  }

  /* ============ PAYMENT TROUBLE POPUP (manual UPI) — from the Alankaar site ============
     Opens ONLY when the customer taps "Having trouble paying?" or the
     floating button (which appears only after an attempt that didn't
     complete). Manual payments are verified by a person, so nothing here
     marks an order paid, sends access, or fires Purchase. */
  var PR = C.PAYMENT_RECOVERY || {};
  var recoveryEl = document.getElementById("payRecovery");
  var helpFloat = document.getElementById("payHelpFloat");
  var PAY_DIGITS = String(PR.PAY_PHONE_NUMBER || "").replace(/\D/g, "").slice(-10);
  var lastFocus = null;

  function screenshotMessage() {
    var d = lastData || readForm(), a = attempt || {};
    var lines = ['Hi, I have paid ' + U.rupees(PRICE) + ' for the "30 Raag eBook" by UPI. I am sending my payment screenshot. Please verify it and share my eBook access.', ""];
    if (d.fullName) lines.push("Name: " + d.fullName);
    if (d.email) lines.push("Email: " + d.email);
    if (d.whatsapp) lines.push("WhatsApp: " + d.whatsapp);
    if (a.attemptId) lines.push("Attempt ref: " + a.attemptId);
    return lines.join("\n");
  }
  function setupRecovery() {
    var upiEl = document.getElementById("payUpiId"); if (upiEl) upiEl.textContent = PR.UPI_ID || "";
    var qr = document.getElementById("payQrImg");
    if (qr) { qr.addEventListener("error", function () { qr.style.display = "none"; }); if (PR.QR_IMAGE) qr.src = PR.QR_IMAGE; else qr.style.display = "none"; }
    var phoneBlock = document.getElementById("payPhoneBlock");
    if (phoneBlock) {
      if (PAY_DIGITS.length === 10) {
        document.getElementById("payPhoneNumber").textContent = "+91 " + PAY_DIGITS.slice(0, 5) + " " + PAY_DIGITS.slice(5);
        var nm = document.getElementById("payPhoneName");
        if (PR.PAY_PHONE_NAME) nm.textContent = PR.PAY_PHONE_NAME; else nm.parentElement.style.display = "none";
      } else phoneBlock.style.display = "none";
    }
    var appRow = document.getElementById("payAppRow"), appTop = document.getElementById("payAppTop");
    (PR.APP_BADGES || []).forEach(function (b) {
      var chip = document.createElement("span"); chip.className = "pr-app";
      var txt = document.createElement("span"); txt.className = "pr-app-text"; txt.textContent = b.name;
      var img = document.createElement("img"); img.alt = b.name; img.loading = "lazy"; img.decoding = "async";
      img.addEventListener("error", function () { img.remove(); chip.appendChild(txt); });
      img.src = b.image; chip.appendChild(img);
      ((b.top && appTop) || appRow).appendChild(chip);
    });
    document.getElementById("paySupportNumber").textContent = C.SUPPORT_PHONE_DISPLAY;
    document.getElementById("payCallLink").href = "tel:+" + C.WHATSAPP_NUMBER;
    document.getElementById("paySupportWhatsapp").href = waLink("Hi, I'm having trouble paying for the 30 Raag eBook. Can you help?");
  }
  function showRecovery() {
    if (!recoveryEl || completed) return;
    document.getElementById("payWhatsappBtn").href = waLink(screenshotMessage());
    ["payCopied", "payCopiedPhone"].forEach(function (id) { var c = document.getElementById(id); if (c) c.textContent = ""; });
    lastFocus = document.activeElement;
    recoveryEl.classList.add("open"); recoveryEl.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    recoveryEl.querySelector(".pay-recovery").scrollTop = 0;
    setTimeout(function () { try { document.getElementById("payRecoveryClose").focus({ preventScroll: true }); } catch (e) {} }, 50);
  }
  function hideRecovery() {
    if (!recoveryEl || !recoveryEl.classList.contains("open")) return;
    recoveryEl.classList.remove("open"); recoveryEl.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus({ preventScroll: true }); } catch (e) {} }
  }
  function legacyCopy(text) {
    var ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;";
    document.body.appendChild(ta); ta.select();
    var ok = false; try { ok = document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta); return ok;
  }
  function copyText(text, outId, okMsg) {
    var out = document.getElementById(outId);
    var done = function (ok) { out.style.color = ok ? "#1F7A4D" : "var(--ink-soft)"; out.textContent = ok ? okMsg : "Couldn't copy — press and hold the text above to copy it."; setTimeout(function () { out.textContent = ""; }, 3500); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(legacyCopy(text)); });
    else done(legacyCopy(text));
  }
  // The floating "Payment failed? — Pay here" button is always visible now;
  // after an unsuccessful attempt it gets an extra attention pulse.
  function revealHelpFloat() { if (helpFloat && recoveryEl) { helpFloat.classList.add("attn"); placeHelpFloat(); } }
  function placeHelpFloat() {
    if (!helpFloat || helpFloat.hidden) return;
    var wa = document.getElementById("supportFloat");
    if (wa) { var r = wa.getBoundingClientRect(); if (r.height > 0) { helpFloat.style.bottom = Math.round(window.innerHeight - r.top + 12) + "px"; helpFloat.style.right = Math.round(window.innerWidth - r.right) + "px"; } }
    var f = helpFloat.getBoundingClientRect(), b = btn.getBoundingClientRect();
    var overlap = !(f.right < b.left || f.left > b.right || f.bottom < b.top || f.top > b.bottom);
    helpFloat.classList.toggle("is-tucked", overlap && b.height > 0);
  }
  if (recoveryEl) {
    setupRecovery();
    document.getElementById("payRecoveryClose").addEventListener("click", hideRecovery);
    document.getElementById("payRetryBtn").addEventListener("click", retry);
    document.getElementById("payCopyBtn").addEventListener("click", function () { copyText(String(PR.UPI_ID || ""), "payCopied", "✓ UPI ID copied!"); });
    var pcb = document.getElementById("payCopyPhoneBtn");
    if (pcb) pcb.addEventListener("click", function () { copyText(PAY_DIGITS, "payCopiedPhone", "✓ Phone number copied!"); });
    recoveryEl.addEventListener("click", function (e) { if (e.target === recoveryEl) hideRecovery(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") hideRecovery(); });
    var helpLink = document.getElementById("payHelpLink");
    if (helpLink) helpLink.addEventListener("click", showRecovery);
    if (helpFloat) {
      helpFloat.addEventListener("click", showRecovery);
      var q = false, queue = function () { if (q) return; q = true; requestAnimationFrame(function () { q = false; placeHelpFloat(); }); };
      window.addEventListener("scroll", queue, { passive: true });
      window.addEventListener("resize", queue);
      window.addEventListener("load", queue);
      placeHelpFloat();
    }
  } else if (helpFloat) {
    helpFloat.style.display = "none";
  }

  // Back-button restore from bfcache: never show a stale busy button.
  window.addEventListener("pageshow", function (e) { if (e.persisted && !completed && phase !== "open") { phase = "idle"; resetButton(); } });
});
