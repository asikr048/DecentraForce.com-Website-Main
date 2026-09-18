/**
 * DecentraForce Meta Pixel Event Tracking Engine
 * Pixel ID: 1394339712274662
 * https://decentraforce.com / https://decentraforce.vercel.app
 */

(function () {
  'use strict';

  // Safe wrapper to call fbq
  function trackEvent(eventType, eventName, params = {}) {
    try {
      if (typeof window.fbq === 'function') {
        if (eventType === 'standard') {
          window.fbq('track', eventName, params);
        } else {
          window.fbq('trackCustom', eventName, params);
        }
        // Dev log
        console.log(`[Pixel Tracker] [${eventType.toUpperCase()}] ${eventName}:`, params);
      }
    } catch (err) {
      console.warn('[Pixel Tracker] Error firing event:', eventName, err);
    }
  }

  // Global tracker API for application triggers
  window.DFTracker = {
    /**
     * Trigger 1: Course Page View (ViewContent)
     * Fires when a user views a specific course details page
     */
    trackCourseView: function (course) {
      if (!course) return;
      const price = parseFloat(course.discount_price || course.price || 0);
      const title = (course.title || 'Course').replace(/<[^>]+>/g, '').trim();
      trackEvent('standard', 'ViewContent', {
        content_name: title,
        content_ids: [String(course.id || '')],
        content_type: 'product',
        value: price,
        currency: 'BDT',
        content_category: 'Web3 & AI Education'
      });
    },

    /**
     * Trigger 2: Initiate Checkout
     * Fires when user opens checkout modal or clicks Purchase
     */
    trackInitiateCheckout: function (course, price) {
      if (!course) return;
      const numPrice = parseFloat(price || course.discount_price || course.price || 0);
      const title = (course.title || 'Course').replace(/<[^>]+>/g, '').trim();
      trackEvent('standard', 'InitiateCheckout', {
        content_name: title,
        content_ids: [String(course.id || '')],
        content_type: 'product',
        value: numPrice,
        currency: 'BDT'
      });
    },

    /**
     * Trigger 3: Successful Purchase
     * Fires when student submits payment and receives success
     */
    trackPurchase: function (course, price, transactionId) {
      if (!course) return;
      const numPrice = parseFloat(price || course.discount_price || course.price || 0);
      const title = (course.title || 'Course').replace(/<[^>]+>/g, '').trim();
      trackEvent('standard', 'Purchase', {
        content_name: title,
        content_ids: [String(course.id || '')],
        content_type: 'product',
        value: numPrice,
        currency: 'BDT',
        transaction_id: String(transactionId || '')
      });
    },

    /**
     * Trigger 4: Free Enrollment / Lead
     * Fires when a student enrolls in a free course
     */
    trackFreeEnroll: function (course) {
      if (!course) return;
      const title = (course.title || 'Free Course').replace(/<[^>]+>/g, '').trim();
      trackEvent('standard', 'Lead', {
        content_name: title,
        content_ids: [String(course.id || '')],
        content_category: 'Free Course Enrollment'
      });
    },

    /**
     * Trigger 5: Account Registration
     * Fires when a new user registers an account
     */
    trackRegistration: function () {
      trackEvent('standard', 'CompleteRegistration', {
        status: 'success',
        platform: 'DecentraForce'
      });
    },

    /**
     * Trigger 6: Account Login
     * Fires when a user logs in
     */
    trackLogin: function () {
      trackEvent('custom', 'UserLogin', {
        status: 'success'
      });
    }
  };

  // ════════════════════════════════════════════════════════════
  // AUTOMATIC BEHAVIORAL TRIGGERS
  // ════════════════════════════════════════════════════════════

  // ── A. Time-on-Page Engagement Triggers ──
  // Measures true attention. Pauses if the tab is hidden or minimized.
  let activeSeconds = 0;
  const firedTimers = new Set();
  const targetThresholds = [
    { seconds: 15, name: 'TimeSpent_15s' },
    { seconds: 30, name: 'TimeSpent_30s' },
    { seconds: 60, name: 'TimeSpent_60s' },
    { seconds: 180, name: 'TimeSpent_3m' }
  ];

  const timerInterval = setInterval(function () {
    if (document.visibilityState !== 'hidden') {
      activeSeconds += 1;
      for (const t of targetThresholds) {
        if (activeSeconds >= t.seconds && !firedTimers.has(t.name)) {
          firedTimers.add(t.name);
          trackEvent('custom', t.name, {
            page: window.location.pathname,
            title: document.title,
            seconds: t.seconds
          });
        }
      }
    }
  }, 1000);

  // Stop timer after 10 minutes to save resources
  setTimeout(() => clearInterval(timerInterval), 600000);

  // ── B. Scroll Depth Triggers (50% and 90%) ──
  let scrolled50 = false;
  let scrolled90 = false;

  window.addEventListener(
    'scroll',
    function () {
      const scrollY = window.scrollY || window.pageYOffset;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (docHeight <= 0) return;

      const percent = (scrollY / docHeight) * 100;

      if (percent >= 50 && !scrolled50) {
        scrolled50 = true;
        trackEvent('custom', 'ScrollDepth_50', {
          page: window.location.pathname
        });
      }

      if (percent >= 90 && !scrolled90) {
        scrolled90 = true;
        trackEvent('custom', 'ScrollDepth_90', {
          page: window.location.pathname
        });
      }
    },
    { passive: true }
  );

  // ── C. WhatsApp Contact Link Clicks ──
  document.addEventListener('click', function (e) {
    const link = e.target.closest('a[href*="whatsapp.com"], a[href*="wa.me"]');
    if (link) {
      trackEvent('standard', 'Contact', {
        channel: 'WhatsApp',
        url: link.href,
        page: window.location.pathname
      });
    }
  });

  // ── D. Copy Payment Number Detection (bKash / Nagad / Rocket) ──
  document.addEventListener('copy', function () {
    try {
      const selection = window.getSelection().toString().trim();
      const cleaned = selection.replace(/\s+/g, '');
      // Check for Bangladesh mobile number format (013 - 019, 11 digits)
      if (/^01[3-9]\d{8}$/.test(cleaned)) {
        trackEvent('custom', 'CopyPaymentNumber', {
          page: window.location.pathname
        });
      }
    } catch (err) {}
  });

})();
