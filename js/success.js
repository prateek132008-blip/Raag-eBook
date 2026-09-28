/* ==========================================================================
   30 RAAG eBOOK — success.js  (success.html)

   • The page renders instantly; nothing is hidden behind a spinner except the
     download button itself.
   • The Google Drive link is NOT in any front-end file. It is returned by the
     Apps Script "verify" action ONLY after the server has checked this exact
     payment with Razorpay (captured, ₹999, INR, this product).
   • Purchase fires once per payment ID (tracking.js keeps a localStorage flag
     and uses eventID "raag_purchase_<payment_id>", the same event_id the
     server sends via CAPI). Refreshing this page does NOT fire it again.
   • If the server can't be reached at all, the customer is never told the
     payment failed — they're told it is being confirmed and how to get help.
   ========================================================================== */
document.addEventListener("DOMContentLoaded", function () {
  "use strict";
  var C = window.CONFIG, U = window.RaagUtil, T = window.RaagTrack;
  var $ = function (id) { return document.getElementById(id); };

  var params = new URLSearchParams(window.location.search);
  var paymentId = params.get("pid") || "";
  var attemptRef = params.get("ref") || "";
  if (!/^pay_[A-Za-z0-9]{6,40}$/.test(paymentId)) { window.location.replace("index.html"); return; }
  if (!/^RAAG-[A-Z0-9-]{6,48}$/.test(attemptRef)) attemptRef = "";

  var stored = U.jget("sessionStorage", "raag_success") || U.jget("localStorage", "raag_success") || {};
  if (stored.paymentId !== paymentId) stored = {};
  var customer = stored.customer || {};
  var data = {
    name: customer.fullName || "", email: customer.email || "",
    amount: C.PRODUCT_PRICE, attemptId: attemptRef || stored.attemptId || "", paymentId: paymentId
  };

  try { T.start(customer); } catch (e) {}

  var yearEl = $("year"); if (yearEl) yearEl.textContent = new Date().getFullYear();

  function waLink(text) { return "https://wa.me/" + C.WHATSAPP_NUMBER + "?text=" + encodeURIComponent(text); }
  function supportMsg(problem) {
    return 'Hi, I bought the "30 Raag eBook" (' + problem + ").\nPayment ID: " + data.paymentId +
      (data.attemptId ? "\nRef: " + data.attemptId : "") + (data.email ? "\nEmail: " + data.email : "") + (data.name ? "\nName: " + data.name : "");
  }
  function setSupport(problem) { $("supportWa").href = waLink(supportMsg(problem)); }
  $("supportFloat").addEventListener("click", function () { window.open(waLink(supportMsg("question about my purchase")), "_blank", "noopener"); });

  function renderDetails() {
    var list = $("detailList"); list.textContent = "";
    [["Product", C.PRODUCT_NAME], ["Name", data.name], ["Email", data.email], ["Amount", U.rupees(data.amount)],
     ["Reference", data.attemptId], ["Payment ID", data.paymentId]].forEach(function (r) {
      if (!r[1]) return;
      var row = document.createElement("div"), l = document.createElement("span"), v = document.createElement("strong");
      l.textContent = r[0]; v.textContent = r[1]; row.appendChild(l); row.appendChild(v); list.appendChild(row);
    });
  }

  function setIcon(kind) {
    var ic = $("successIcon");
    ic.className = "success-icon" + (kind === "ok" ? "" : " " + kind);
    ic.innerHTML = kind === "ok"
      ? '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>'
      : kind === "bad"
        ? '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/></svg>'
        : '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>';
  }

  function showPaid(res) {
    setIcon("ok");
    $("title").textContent = "Payment Successful 🎉";
    $("subtitle").innerHTML = "";
    $("subtitle").append("Thank you for purchasing ", Object.assign(document.createElement("strong"), { textContent: "30 Raag" }), " — Detailed Raag Parichay & Notation.");
    var box = $("downloadBox"); box.textContent = "";
    var link = String(res.driveLink || "");
    if (/^https:\/\/(drive|docs)\.google\.com\//.test(link)) {
      var a = document.createElement("a");
      a.className = "btn btn-primary btn-block"; a.href = link; a.target = "_blank"; a.rel = "noopener";
      a.textContent = "Download Your eBook (Google Drive)";
      var p = document.createElement("p");
      p.textContent = "Tip: bookmark this page or save the Drive link. " + (res.emailSent || data.email ? "A copy of the link is also emailed to " + (data.email || "your email") + " (check Promotions/Spam)." : "");
      box.appendChild(a); box.appendChild(p);
      setSupport("download link not working");
    } else {
      var q = document.createElement("p");
      q.style.marginTop = "0";
      q.textContent = "Your payment is confirmed. Your download link will be sent to you shortly — if you'd like it right away, tap WhatsApp Support below with your Payment ID.";
      box.appendChild(q);
      setSupport("payment confirmed, need download link");
    }
    $("lifetimePill").hidden = false;
  }

  function showChecking(text) {
    setIcon("checking");
    $("title").textContent = "Payment received — confirming…";
    var box = $("downloadBox"); box.textContent = "";
    var s = document.createElement("div"); s.className = "success-status";
    s.innerHTML = '<span class="spinner" aria-hidden="true"></span><span></span>';
    s.lastChild.textContent = text; box.appendChild(s);
  }

  function showUnconfirmed() {
    setIcon("checking");
    $("title").textContent = "We're confirming your payment";
    $("subtitle").textContent = "Razorpay has taken your payment request. Confirmation is taking longer than usual.";
    var box = $("downloadBox"); box.textContent = "";
    var p = document.createElement("p"); p.style.marginTop = "0";
    p.textContent = "Please don't pay again. Your download link will also be emailed once the payment is confirmed. If nothing arrives within 15 minutes, message us on WhatsApp with the Payment ID below.";
    var b = document.createElement("button"); b.type = "button"; b.className = "btn btn-outline btn-block"; b.style.marginTop = "12px"; b.textContent = "Check again";
    b.addEventListener("click", function () { tries = 0; showChecking("Checking again…"); verify(); });
    box.appendChild(p); box.appendChild(b);
    setSupport("payment confirmation pending");
  }

  function showNotConfirmed(status) {
    setIcon("bad");
    $("title").textContent = "Payment not confirmed";
    $("subtitle").textContent = "Razorpay has not confirmed this payment" + (status ? " (" + String(status).replace(/_/g, " ") + ")" : "") + ".";
    var box = $("downloadBox"); box.textContent = "";
    var p = document.createElement("p"); p.style.marginTop = "0";
    p.textContent = "If money was debited from your account, please don't pay again — message us on WhatsApp with the Payment ID below and we'll sort it out.";
    box.appendChild(p);
    setSupport("payment not confirmed, status: " + status);
  }

  renderDetails();
  setSupport("question about my purchase");
  showChecking("Confirming your payment with Razorpay…");

  var DEFINITE_FAIL = ["failed", "refunded", "amount_mismatch", "wrong_product", "not_found"];
  var DELAYS = [0, 4000, 8000, 15000, 25000, 40000];
  var tries = 0, done = false;

  function purchaseFallbackOk() {
    // Server unreachable: the only other confirmation we have is Razorpay's
    // own success callback on the checkout page (stored.via === "handler").
    return stored.paymentId === paymentId && stored.via === "handler";
  }

  function verify() {
    U.gasCall({ action: "verify", paymentId: paymentId, attemptId: data.attemptId, rzpOrderId: stored.rzpOrderId || "" }, 45000)
      .then(function (res) {
        if (!res || !res.ok) return false;
        if (res.status === "paid") {
          if (res.name && !data.name) data.name = res.name;
          if (res.email && !data.email) data.email = res.email;
          if (res.attemptId && !data.attemptId) data.attemptId = res.attemptId;
          if (res.amount) data.amount = res.amount;
          renderDetails();
          done = true;
          showPaid(res);
          try {
            T.setUser({ fullName: data.name, email: data.email, whatsapp: res.phone || customer.whatsapp });
            T.purchase({ paymentId: paymentId, value: data.amount, orderRef: data.attemptId });
          } catch (e) {}
          return true;
        }
        if (DEFINITE_FAIL.indexOf(res.status) !== -1) { done = true; showNotConfirmed(res.status); return true; }
        showChecking(res.status === "authorized" ? "Payment authorised — finalising with Razorpay…" : "Still confirming your payment…");
        return false;
      })
      .catch(function () { return false; })
      .then(function (finished) {
        if (finished || done) return;
        tries++;
        if (tries < DELAYS.length) { setTimeout(verify, DELAYS[tries]); return; }
        showUnconfirmed();
        if (purchaseFallbackOk()) { try { T.purchase({ paymentId: paymentId, value: C.PRODUCT_PRICE, orderRef: data.attemptId }); } catch (e) {} }
      });
  }

  if (!U.isConfigured(C.GOOGLE_SCRIPT_URL)) {
    showUnconfirmed();
    if (purchaseFallbackOk()) { try { T.purchase({ paymentId: paymentId, value: C.PRODUCT_PRICE, orderRef: data.attemptId }); } catch (e) {} }
  } else {
    verify();
  }
});
