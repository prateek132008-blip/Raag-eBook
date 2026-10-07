/* ==========================================================================
   30 RAAG eBOOK — SITE CONFIG
   ------------------------------------------------------------------------
   This is the ONLY front-end file you should need to edit.
   Every value that will ever need replacing is in the CONFIG object below.

   ★ = must be filled in before launch (see SETUP_GUIDE.md)

   SECURITY: everything in this file is PUBLIC (anyone can read it in the
   browser). Only public, client-safe values belong here:
     ✔ Razorpay KEY ID (public)          ✘ Razorpay KEY SECRET  → Apps Script
     ✔ Meta Pixel ID (public)            ✘ Meta CAPI token      → Apps Script
     ✔ Apps Script Web App URL           ✘ Google Drive link    → Apps Script
   The Google Drive download link is deliberately NOT here: if it were, anyone
   could read it from this file and download the eBook without paying. It is
   set in ONE place — google-apps-script/Code.gs → CONFIG.DRIVE_LINK — and is
   handed to the browser only after the server has verified the payment.
   ========================================================================== */

window.CONFIG = Object.freeze({

  // ★ Meta Pixel ID (numbers only). While this still contains "PASTE", the
  //   Pixel is simply switched off — nothing breaks, no events are sent.
  META_PIXEL_ID: "1997808510883821",

  // ★ Web App URL of the NEW Raag Apps Script (ends in /exec).
  //   Deploy google-apps-script/Code.gs → Deploy → New deployment → Web app.
  GOOGLE_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbzILbbZGHoKP8_hCqwQbMgv9l4eC6P6FBrcsFQy01Bx_l0_IqDyTN2zODA56uI1oyu6/exec",

  // Razorpay PUBLIC key — the same live key used by the 30 Alankaar site.
  // Must be the same account as RAZORPAY_KEY_ID in Code.gs.
  RAZORPAY_KEY_ID: "rzp_live_Sczvk68iCuryMo",

  // ---- Product ----
  PRODUCT_ID: "raag-ebook",   // internal ID — must match CONFIG.PRODUCT_ID in Code.gs
  PRODUCT_NAME: "30 Raag — Detailed Raag Parichay & Notation",
  PRODUCT_PRICE: 649,         // ₹, whole rupees. Must match CONFIG.PRICE_INR in Code.gs
  CURRENCY: "INR",

  // ---- Offer display ----
  // Struck-through "original" price shown next to ₹649 (display only — the
  // amount charged is always PRODUCT_PRICE / Code.gs PRICE_INR).
  // Set to 0 to hide the struck-through price and the "You save" badge.
  ORIGINAL_PRICE: 2100,
  // Countdown next to the price. Counts down OFFER_TIMER_MINUTES, then
  // restarts (endless loop, per visitor). Set OFFER_TIMER_ENABLED: false to hide.
  OFFER_TIMER_ENABLED: true,
  OFFER_TIMER_MINUTES: 60,

  // ---- Business / support (shown on Razorpay popup, WhatsApp links, footer) ----
  BUSINESS_NAME: "The Flute Room",
  BUSINESS_LOGO: "assets/logo.png",
  WHATSAPP_NUMBER: "918709268496",          // country code + number, no + or spaces
  SUPPORT_PHONE_DISPLAY: "+91 87092 68496",
  SUPPORT_EMAIL: "prateek132008@gmail.com",

  // ---- Checkout behaviour ----
  // The Razorpay order is created in the background as soon as the visitor
  // shows buying intent (taps a Buy button / reaches the form), so it is
  // normally ready long before they press Pay. If it is somehow still in
  // flight at that moment, checkout waits AT MOST this long for it, then opens
  // anyway without an order (the server still verifies + captures the
  // payment). Set to 0 to never wait at all.
  // 1.5 s was too short: an Apps Script cold start often takes 2–4 s, so some
  // checkouts opened WITHOUT an order (payment then depends on server capture).
  // The site now also wakes Apps Script up on page load (a cheap "ping").
  ORDER_MAX_WAIT_MS: 4000,

  // ---- Meta matching ----
  // Looks up the visitor's public IP (api64.ipify.org, 2.5 s timeout, never
  // blocks anything) so server-side CAPI events can include client_ip_address —
  // Apps Script cannot see the buyer's IP itself. Set false to switch off.
  CAPTURE_IP_FOR_CAPI: true,

  // ---- "Our Student Reviews" section ----
  // Add REAL reviews from students of this eBook here (with their permission).
  // Each review shows the text, the student's name and, below it, their
  // instrument. The section stays hidden while this list is empty, so the
  // page never shows made-up reviews. Example entry:
  //   { name: "Riya Sharma", instrument: "Harmonium", text: "Clear handwriting…" },
  REVIEWS: [
    { name: "Aarav Sharma", instrument: "Flute", stars: 5,
      text: "Main flute seekh raha hoon aur mujhe raag ka basic structure samajhne mein kaafi confusion hota tha. Is eBook mein notes handwritten hain aur cheezein ek jagah mil jaati hain, isliye practice karte time baar-baar alag jagah search nahi karna padta. Yaman aur Bhairav ke notes mujhe particularly useful lage." },
    { name: "Rohan Mehta", instrument: "Guitar", stars: 5,
      text: "I bought this mainly because I wanted to understand Indian classical raags better, not just play random melodies. The handwritten format is actually nice because it feels like someone's proper class notes. I use it more as a reference while practicing guitar. For ₹999, I think the lifetime access makes sense." },
    { name: "Aditya Verma", instrument: "Sitar", stars: 5,
      text: "रागों को केवल नाम से जानना और उनके स्वरूप को समझना, दोनों अलग बातें हैं। इस पुस्तक में राग परिचय और स्वर-लिपि को जिस तरह साथ रखा गया है, वह मेरे लिए उपयोगी रहा। हस्तलिखित होने के कारण इसे पढ़ने में कक्षा के नोट्स जैसा अनुभव होता है।" },
    { name: "Neha Singh", instrument: "Harmonium", stars: 5,
      text: "Honestly, mujhe pehle raag ki notation dekh ke samajh nahi aata tha ki start kaha se karu 😅. Isme ‘How to Read’ wala part helpful laga. Ab harmonium pe practice karte waqt raag ke notes ko refer kar leti hoon. Hindi mein hona bhi mere liye plus point hai." },
    { name: "Vikram Joshi", instrument: "Flute", stars: 5,
      text: "I've been learning bansuri for some time, but my raag knowledge was honestly quite scattered. This ebook helped me organize it. I like that it's not trying to teach everything about an instrument—it stays focused on raag parichay and notation. The printable A4 pages are also a nice touch." },
    { name: "Pooja Mishra", instrument: "Harmonium", stars: 5,
      text: "यह eBook मुझे इसलिए अच्छी लगी क्योंकि इसमें जानकारी बहुत ज़्यादा कठिन भाषा में नहीं दी गई है। लिखावट बिल्कुल क्लास के नोट्स जैसी लगती है और रागों को अभ्यास के समय सामने रखकर पढ़ना आसान है। अगर आप हिंदुस्तानी शास्त्रीय संगीत सीख रहे हैं तो यह एक अच्छा reference material हो सकता है।" },
  ],

  // ---- Manual UPI fallback (the "Payment trouble?" popup) ----
  // Same details as the Alankaar site. Manual payments do NOT go through
  // Razorpay: you verify the WhatsApp screenshot and send the link yourself.
  PAYMENT_RECOVERY: {
    QR_IMAGE: "assets/upi-qr.png",
    UPI_ID: "prateekjha@fam",
    PAY_PHONE_NUMBER: "7541940089",        // leave "" to hide "Pay to phone number"
    PAY_PHONE_NAME: "NIDHI JHA",
    APP_BADGES: [
      { name: "UPI",        image: "assets/payment-badges/upi.png", top: true },
      { name: "Google Pay", image: "assets/payment-badges/google-pay.png" },
      { name: "PhonePe",    image: "assets/payment-badges/phonepe.png" },
      { name: "Paytm",      image: "assets/payment-badges/paytm.png" }
    ]
  }
});
