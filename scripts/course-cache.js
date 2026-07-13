/**
 * Course Caching Module
 * Always fetches fresh data from API; localStorage is used only as a
 * short-term fallback when the API is temporarily unreachable.
 *
 * TTL is 60 s — short enough that status changes made in the admin panel
 * are visible to users within one minute.  The admin panel also explicitly
 * clears the cache on every course save / delete.
 */

const CACHE_KEY           = 'courses';
const CACHE_TIMESTAMP_KEY = 'courses_timestamp';
const CACHE_EXPIRY_MS     = 60 * 1000; // 60 seconds

/**
 * Get courses.  Always tries the API first; falls back to cache on error.
 * @returns {Promise<Array>}
 */
export async function getCourses() {
  try {
    const response = await fetch('/api/_public/courses');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    if (!data.success || !Array.isArray(data.courses)) {
      throw new Error('Invalid API response');
    }

    cacheCourses(data.courses);
    return data.courses;
  } catch (error) {
    console.warn('Courses API unavailable, trying cache:', error.message);

    const cached = getCachedCourses(true); // accept any age
    if (cached && cached.length > 0) {
      console.log('Using cached courses as fallback');
      return cached;
    }

    throw error;
  }
}

/**
 * Read from localStorage cache.
 * @param {boolean} force  If true, ignore expiry and return even stale data.
 * @returns {Array|null}
 */
function getCachedCourses(force = false) {
  try {
    const raw  = localStorage.getItem(CACHE_KEY);
    const ts   = localStorage.getItem(CACHE_TIMESTAMP_KEY);
    if (!raw || !ts) return null;
    const age  = Date.now() - parseInt(ts, 10);
    if (!force && age > CACHE_EXPIRY_MS) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Write courses + current timestamp to localStorage. */
function cacheCourses(courses) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(courses));
    localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
  } catch (e) {
    console.warn('Could not cache courses:', e.message);
  }
}

/** Remove cached data.  Called by the admin panel after saving or deleting a course. */
export function clearCourseCache() {
  localStorage.removeItem(CACHE_KEY);
  localStorage.removeItem(CACHE_TIMESTAMP_KEY);
}

/**
 * Force a fresh API fetch, bypassing any cached data.
 * @returns {Promise<Array>}
 */
export async function refreshCourses() {
  clearCourseCache();
  return getCourses();
}

/**
 * Return cache metadata (useful for admin debugging).
 * @returns {Object}
 */
export function getCacheStatus() {
  const raw = localStorage.getItem(CACHE_KEY);
  const ts  = localStorage.getItem(CACHE_TIMESTAMP_KEY);

  if (!raw || !ts) return { hasCache: false, age: null, expired: true };

  const age     = Date.now() - parseInt(ts, 10);
  const expired = age > CACHE_EXPIRY_MS;

  return {
    hasCache: true,
    age,
    expired,
    ageFormatted: _formatAge(age),
    itemCount: JSON.parse(raw).length,
  };
}

function _formatAge(ms) {
  if (ms < 60000)   return `${Math.floor(ms / 1000)} seconds`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)} minutes`;
  return `${Math.floor(ms / 3600000)} hours`;
}
