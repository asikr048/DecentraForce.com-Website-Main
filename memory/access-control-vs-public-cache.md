---
name: access-control-vs-public-cache
description: Lecture access (public vs enrolled-only) is read from the cached /api/_public/courses, so access-sensitive pages must fetch fresh
metadata:
  type: project
---

`GET /api/_public/courses` ([api/index.js](../api/index.js)) sets `Cache-Control: public, max-age=30, s-maxage=60, stale-while-revalidate=300` (browser + Vercel CDN cache). The per-lecture access flag (`lec.access === 'public'` vs `enrolled_only`) is derived from this same cached `modules` JSON.

**Gotcha:** when an admin flips a lecture public→private, cached clients (esp. mobile, which caches longer) keep the stale "public" flag and the lecture stays unlocked — even though the DB updated instantly. This surfaced as "private videos still accessible on mobile but not PC".

**How to apply:** any page that *enforces* access (course-view.html, and course-details.html which builds the "Free Preview" links) must fetch with `fetch('/api/_public/courses?t=' + Date.now(), { cache: 'no-store' })` — the unique `?t=` busts the CDN edge cache, `no-store` busts the browser cache. Do NOT rely on the cached catalog response for access decisions. Marketing/catalog pages (index.html) may keep the cache.

Related: video URLs for enrolled-only lectures are still present in the payload (network-inspectable) — a separate, lower-priority leak not yet fixed.
