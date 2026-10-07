/* ==========================================================================
   30 RAAG eBOOK — common.js
   Small shared helpers used by every page. No side effects except:
     • creating a first-party visitor ID (external_id for Meta matching)
     • remembering the ad/UTM attribution of this visit
   Loaded after js/config.js and before js/tracking.js.
   ========================================================================== */
(function () {
  "use strict";
  var C = window.CONFIG || {};

  /* ---- Safe storage: localStorage/sessionStorage can THROW (private mode,
     some Instagram/Facebook in-app browsers). Never let that break payment. */
  var mem = {};
  function sget(area, key) {
    try { var v = window[area].getItem(key); if (v !== null) return v; } catch (e) {}
    return Object.prototype.hasOwnProperty.call(mem, area + key) ? mem[area + key] : null;
  }
  function sset(area, key, value) {
    mem[area + key] = String(value);
    try { window[area].setItem(key, value); } catch (e) {}
  }
  function sremove(area, key) {
    delete mem[area + key];
    try { window[area].removeItem(key); } catch (e) {}
  }
  function jget(area, key) { try { return JSON.parse(sget(area, key) || "null"); } catch (e) { return null; } }
  function jset(area, key, obj) { sset(area, key, JSON.stringify(obj)); }

  function getCookie(name) {
    var m = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/[.$?*|{}()[\]\\/+^]/g, "\\$&") + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : "";
  }

  function randomId(len) {
    var out = "";
    try {
      var bytes = new Uint8Array(len);
      window.crypto.getRandomValues(bytes);
      for (var i = 0; i < bytes.length; i++) out += (bytes[i] % 36).toString(36);
    } catch (e) {
      while (out.length < len) out += Math.random().toString(36).slice(2);
      out = out.slice(0, len);
    }
    return out;
  }

  /* ---- First-party visitor ID → Meta external_id (hashed by the Pixel and
     by the server before sending), also written to the Sheet. */
  var VID_KEY = "raag_vid";
  var visitorId = sget("localStorage", VID_KEY);
  if (!visitorId || !/^v_[a-z0-9]{10,40}$/.test(visitorId)) {
    visitorId = "v_" + Date.now().toString(36) + randomId(10);
    sset("localStorage", VID_KEY, visitorId);
  }

  /* ---- Attribution (UTM + fbclid + landing page + referrer).
     A visit that arrives WITH utm/fbclid overwrites what we had (latest ad
     click wins); a plain visit keeps the earlier campaign data. */
  var ATTR_KEY = "raag_attr";
  var UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
  (function captureAttribution() {
    var p;
    try { p = new URLSearchParams(window.location.search); } catch (e) { return; }
    var fresh = { fbclid: p.get("fbclid") || "" };
    var hasCampaign = !!fresh.fbclid;
    UTM_KEYS.forEach(function (k) { fresh[k] = (p.get(k) || "").slice(0, 150); if (fresh[k]) hasCampaign = true; });
    var existing = jget("localStorage", ATTR_KEY);
    if (hasCampaign || !existing) {
      fresh.landing_page = (window.location.origin + window.location.pathname + window.location.search).slice(0, 500);
      fresh.referrer = (document.referrer || "").slice(0, 300);
      fresh.ts = Date.now();
      jset("localStorage", ATTR_KEY, fresh);
    }
  })();
  function getAttribution() { return jget("localStorage", ATTR_KEY) || {}; }

  /* ---- fbp / fbc (Meta browser IDs). The Pixel writes _fbp/_fbc cookies
     itself; if _fbc is missing but we saw an fbclid, build it in Meta's
     documented format fb.1.<ms timestamp>.<fbclid>. Never invented. */
  function getFbp() { return getCookie("_fbp"); }
  function getFbc() {
    var c = getCookie("_fbc");
    if (c) return c;
    var a = getAttribution();
    return a.fbclid ? "fb.1." + (a.ts || Date.now()) + "." + a.fbclid : "";
  }

  function isConfigured(v) { return !!v && String(v).indexOf("PASTE") === -1; }
  function phone10(v) { return String(v || "").replace(/\D/g, "").slice(-10); }
  function splitName(full) {
    var parts = String(full || "").trim().split(/\s+/).filter(Boolean);
    return { first: parts[0] || "", last: parts.slice(1).join(" ") };
  }
  function rupees(n) { return "₹" + Number(n).toLocaleString("en-IN"); }

  /* ---- Apps Script client. Every call has a hard timeout; nothing can hang. */
  function gasUrl(params) { return C.GOOGLE_SCRIPT_URL + "?" + new URLSearchParams(params).toString(); }
  function gasCall(params, timeoutMs) {
    if (!isConfigured(C.GOOGLE_SCRIPT_URL)) return Promise.reject(new Error("GOOGLE_SCRIPT_URL not configured"));
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var t = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeoutMs || 15000);
    return fetch(gasUrl(params), { method: "GET", cache: "no-store", redirect: "follow", signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { return r.json(); })
      .finally(function () { clearTimeout(t); });
  }
  // Fire-and-forget logging. keepalive lets it finish even if the page is
  // navigating away; no-cors means we never wait on / read the response.
  function gasFire(params) {
    if (!isConfigured(C.GOOGLE_SCRIPT_URL)) return;
    try { fetch(gasUrl(params), { method: "GET", mode: "no-cors", keepalive: true, cache: "no-store" }).catch(function () {}); } catch (e) {}
  }

  /* ---- Visitor's public IP, for server-side CAPI matching only (Apps Script
     can't see it). Fetched once per session, 2.5 s timeout, never blocks. */
  var IP_KEY = "raag_ip";
  var clientIp = sget("sessionStorage", IP_KEY) || "";
  function loadClientIp() {
    if (clientIp || C.CAPTURE_IP_FOR_CAPI === false || typeof fetch !== "function") return;
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var t = setTimeout(function () { if (ctrl) ctrl.abort(); }, 2500);
    fetch("https://api64.ipify.org?format=json", { cache: "no-store", signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var ip = String((j && j.ip) || "");
        if (/^[0-9a-fA-F:.]{7,45}$/.test(ip)) { clientIp = ip; sset("sessionStorage", IP_KEY, ip); }
      })
      .catch(function () {})
      .finally(function () { clearTimeout(t); });
  }
  function getClientIp() { return clientIp; }

  /* ---- Wake the Apps Script web app up early (cold starts take seconds). */
  function warmUp() { gasFire({ action: "ping" }); }

  /* ---- Customer details typed on this device (for Pixel advanced matching
     on later page views). Kept 30 days, only on this device. */
  var CUST_KEY = "raag_cust";
  function saveCustomer(c) {
    if (!c || !c.email) return;
    jset("localStorage", CUST_KEY, { fullName: c.fullName || c.name || "", email: c.email, whatsapp: c.whatsapp || c.phone || "", ts: Date.now() });
  }
  function getSavedCustomer() {
    var c = jget("localStorage", CUST_KEY);
    return c && c.email && Date.now() - (c.ts || 0) < 30 * 24 * 3600 * 1000 ? c : null;
  }

  window.RaagUtil = {
    sget: sget, sset: sset, sremove: sremove, jget: jget, jset: jset,
    getCookie: getCookie, randomId: randomId, visitorId: visitorId,
    getAttribution: getAttribution, getFbp: getFbp, getFbc: getFbc,
    isConfigured: isConfigured, phone10: phone10, splitName: splitName, rupees: rupees,
    gasCall: gasCall, gasFire: gasFire,
    loadClientIp: loadClientIp, getClientIp: getClientIp, warmUp: warmUp,
    saveCustomer: saveCustomer, getSavedCustomer: getSavedCustomer,
    debug: /[?&]debug=1\b/.test(window.location.search)
  };
})();
