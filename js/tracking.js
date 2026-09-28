/* ==========================================================================
   30 RAAG eBOOK — tracking.js
   THE ONE AND ONLY place Meta Pixel code lives on this site.
   (There is no inline fbq() anywhere in the HTML — search the project for
   "fbq(" and you will only find this file.)

   Events and when they fire:
     PageView          — once per page load (every page), right after init
     ViewContent       — once per page load, product page only
     InitiateCheckout  — once per checkout ATTEMPT (retries of the same attempt
                         do not re-fire), after the form passes validation
     Purchase          — once per Razorpay payment ID, success page only, only
                         after the payment is confirmed (see js/success.js)

   Deduplication:
     • a load guard makes it impossible to initialise the Pixel twice
     • every event carries an eventID; per-event "already fired" flags are
       kept in memory + sessionStorage/localStorage
     • Purchase eventID = "raag_purchase_<razorpay_payment_id>" — the Apps
       Script sends its server-side (CAPI) Purchase with the SAME event_id,
       so Meta counts browser + server as ONE purchase

   Advanced matching (EMQ): em, ph, fn, ln, external_id, country are passed
   in plain text to fbq('init') — the Pixel normalises and SHA-256 hashes them
   in the browser before sending. fbp/fbc are the Pixel's own cookies.
   If CONFIG.META_PIXEL_ID still contains "PASTE", everything here is a no-op.
   ========================================================================== */
(function () {
  "use strict";
  if (window.RaagTrack) return; // loaded twice? never initialise twice

  var C = window.CONFIG || {};
  var U = window.RaagUtil;
  var PIXEL_ID = String(C.META_PIXEL_ID || "").trim();
  var enabled = U.isConfigured(PIXEL_ID) && /^\d{6,20}$/.test(PIXEL_ID);
  var fired = {};                       // in-memory "already sent" flags
  var lastUserKey = "";

  function log() { if (U.debug && window.console) console.log.apply(console, ["[RaagPixel]"].concat([].slice.call(arguments))); }

  if (!enabled) {
    log("Pixel disabled — META_PIXEL_ID not set in js/config.js");
  } else {
    /* Standard Meta base code (unchanged), guarded by `if (f.fbq) return`. */
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = "2.0"; n.queue = []; t = b.createElement(e); t.async = !0;
      t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    }(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
  }

  /* ---- Build the advanced-matching object from customer details. Plain text
     on purpose: the Pixel hashes it. Empty fields are omitted, never guessed. */
  function userData(c) {
    c = c || {};
    var d = { external_id: U.visitorId, country: "in" };
    var email = String(c.email || "").trim().toLowerCase();
    var p10 = U.phone10(c.whatsapp || c.phone);
    var n = U.splitName(c.fullName || c.name);
    if (email) d.em = email;
    if (p10.length === 10) d.ph = "91" + p10;
    if (n.first) d.fn = n.first.toLowerCase();
    if (n.last) d.ln = n.last.toLowerCase();
    return d;
  }

  function init(customer) {
    if (!enabled) return;
    var d = userData(customer);
    var key = JSON.stringify(d);
    if (key === lastUserKey) return;    // nothing new — don't re-init
    lastUserKey = key;
    // fbq('init', id, userData) is Meta's documented manual advanced-matching
    // call. Re-running it with richer data updates the matching keys and does
    // NOT send any event.
    fbq("init", PIXEL_ID, d);
    log("init", d);
  }

  function once(flagKey, persist, fn) {
    if (fired[flagKey]) return false;
    if (persist && U.sget(persist, flagKey)) { fired[flagKey] = true; return false; }
    fired[flagKey] = true;
    if (persist) U.sset(persist, flagKey, "1");
    fn();
    return true;
  }

  function track(name, params, eventId) {
    if (!enabled) { log("(disabled)", name, params, eventId); return; }
    fbq("track", name, params, { eventID: eventId });
    log("track", name, params, { eventID: eventId });
  }

  var pageLoadId = Date.now().toString(36) + U.randomId(6);
  var baseParams = function () {
    return {
      content_name: C.PRODUCT_NAME,
      content_ids: [C.PRODUCT_ID],
      content_type: "product",
      contents: [{ id: C.PRODUCT_ID, quantity: 1, item_price: C.PRODUCT_PRICE }],
      value: C.PRODUCT_PRICE,
      currency: C.CURRENCY || "INR"
    };
  };

  window.RaagTrack = {
    enabled: enabled,

    /* Called once per page by the page script (with any stored customer
       details, e.g. on the success page) → init + PageView. */
    start: function (customer) {
      once("pv_" + pageLoadId, null, function () {
        init(customer);
        track("PageView", {}, "raag_pv_" + pageLoadId);
      });
    },

    /* Update matching keys once the visitor has typed their details. */
    setUser: function (customer) { init(customer); },

    viewContent: function () {
      once("vc_" + pageLoadId, null, function () {
        track("ViewContent", baseParams(), "raag_vc_" + pageLoadId);
      });
    },

    initiateCheckout: function (attemptId) {
      if (!attemptId) return;
      once("raag_ic_" + attemptId, "sessionStorage", function () {
        var p = baseParams(); p.num_items = 1;
        track("InitiateCheckout", p, "raag_ic_" + attemptId);
      });
    },

    /* Purchase — call ONLY with a confirmed Razorpay payment ID. */
    purchase: function (info) {
      if (!info || !/^pay_[A-Za-z0-9]{6,40}$/.test(info.paymentId || "")) return false;
      return once("raag_purchase_fired_" + info.paymentId, "localStorage", function () {
        var p = baseParams(); p.num_items = 1;
        if (info.value) p.value = Number(info.value);
        if (info.orderRef) p.order_id = info.orderRef;
        track("Purchase", p, "raag_purchase_" + info.paymentId);
      });
    }
  };
})();
