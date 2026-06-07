/**
 * DecentraForce — Single Serverless Function
 * All routes consolidated here to stay within Vercel Hobby (12 function) limit.
 * Route dispatch is done via req.url path matching.
 */

import { query, getPool } from '../lib/db.js';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

// ─── CORS helper ──────────────────────────────────────────────────────────────
function setCors(req, res) {
  const origin = req.headers.origin || '';
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',
    'X-CSRF-Token,X-Requested-With,Accept,Accept-Version,Content-Length,Content-MD5,Content-Type,Date,X-Api-Version');
}

// ─── Role-based session checks ────────────────────────────────────────────────
// requireAdmin      → only is_admin=TRUE (super admin)
// requireManagerOrAbove → is_admin OR role='manager'
// requireStaff      → is_admin OR role IN ('manager','task_manager')

async function requireAdmin(req, res) {
  const token = req.cookies?.session_token;
  if (!token) { res.status(401).json({ success: false, error: 'Unauthorized' }); return null; }
  const r = await query(
    `SELECT id, email, password_hash, role FROM users WHERE session_token=$1 AND session_expires>NOW() AND is_admin=TRUE`,
    [token]
  );
  if (!r.rows.length) { res.status(403).json({ success: false, error: 'Forbidden' }); return null; }
  return r.rows[0];
}

async function requireManagerOrAbove(req, res) {
  const token = req.cookies?.session_token;
  if (!token) { res.status(401).json({ success: false, error: 'Unauthorized' }); return null; }
  const r = await query(
    `SELECT id, email, password_hash, role, is_admin FROM users WHERE session_token=$1 AND session_expires>NOW() AND (is_admin=TRUE OR role='manager')`,
    [token]
  );
  if (!r.rows.length) { res.status(403).json({ success: false, error: 'Forbidden: Manager or Admin required' }); return null; }
  return r.rows[0];
}

async function requireStaff(req, res) {
  const token = req.cookies?.session_token;
  if (!token) { res.status(401).json({ success: false, error: 'Unauthorized' }); return null; }
  const r = await query(
    `SELECT id, email, password_hash, role, is_admin FROM users WHERE session_token=$1 AND session_expires>NOW() AND (is_admin=TRUE OR role IN ('manager','task_manager'))`,
    [token]
  );
  if (!r.rows.length) { res.status(403).json({ success: false, error: 'Forbidden: Staff access required' }); return null; }
  return r.rows[0];
}

// Resolve the logged-in user (any role) from the session cookie. Returns null on failure
// and writes a 401 response. Used by progress / reviews / certificate endpoints.
async function requireUser(req, res) {
  const token = req.cookies?.session_token;
  if (!token) { res.status(401).json({ success: false, error: 'Not authenticated' }); return null; }
  const r = await query(
    `SELECT id, username, email FROM users WHERE session_token=$1 AND session_expires>NOW()`,
    [token]
  );
  if (!r.rows.length) { res.status(401).json({ success: false, error: 'Invalid or expired session' }); return null; }
  return r.rows[0];
}

// True when the user has been granted access to the course (enrolled).
async function isEnrolled(userId, courseId) {
  const r = await query('SELECT 1 FROM user_courses WHERE user_id=$1 AND course_id=$2', [userId, courseId]);
  return r.rows.length > 0;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

// ── PUBLIC: GET /api/_public/courses ─────────────────────────────────────────
async function publicCourses(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const r = await query(`
    SELECT c.id, c.title, c.description,
      CASE WHEN length(c.thumbnail_url)>2000000 THEN '' ELSE c.thumbnail_url END AS thumbnail_url,
      c.modules, c.created_at, c.price, c.discount_price, c.whatsapp, c.status, c.sequence_order,
      COALESCE(c.category,'General') AS category,
      COALESCE(ROUND(AVG(r.rating)::numeric,1),0) AS avg_rating,
      COUNT(r.id)::int AS review_count
    FROM courses c
    LEFT JOIN course_reviews r ON r.course_id = c.id
    WHERE c.is_active=TRUE
    GROUP BY c.id
    ORDER BY COALESCE(c.sequence_order,9999), c.created_at DESC
  `);
  // Edge-cache for 60s (matches the frontend cache TTL) and serve stale while revalidating.
  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=300');
  return res.status(200).json({ success: true, courses: r.rows });
}

// ── PUBLIC: POST /api/_public/verify-coupon ───────────────────────────────────
async function verifyCoupon(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { code, course_id } = req.body || {};
  const r = await query(
    'SELECT id, discount_percent, new_price, course_id FROM coupons WHERE code=$1',
    [(code||'').toUpperCase().trim()]
  );
  if (!r.rows.length) return res.status(400).json({ success: false, error: 'Invalid or expired coupon' });
  const coupon = r.rows[0];
  if (coupon.course_id && course_id && coupon.course_id !== parseInt(course_id)) {
    return res.status(400).json({ success: false, error: 'Coupon not valid for this course' });
  }
  return res.status(200).json({ success: true, discount: coupon.discount_percent, new_price: coupon.new_price });
}

// ── ADMIN: GET/POST/DELETE /api/admin/coupons ────────────────────────────────
async function adminCoupons(req, res) {
  const admin = await requireStaff(req, res); if (!admin) return;

  if (req.method === 'GET') {
    const r = await query(`
      SELECT c.*, co.title AS course_title
      FROM coupons c LEFT JOIN courses co ON c.course_id = co.id
      ORDER BY c.created_at DESC
    `);
    return res.status(200).json({ success: true, coupons: r.rows });
  }

  if (req.method === 'POST') {
    const { code, discount_percent, new_price, course_id } = req.body || {};
    if (!code) return res.status(400).json({ success: false, error: 'Code required' });
    if (!discount_percent && !new_price) return res.status(400).json({ success: false, error: 'Discount % or new price required' });
    const upperCode = (code).toUpperCase().trim();
    const existing = await query('SELECT id FROM coupons WHERE code=$1', [upperCode]);
    if (existing.rows.length) return res.status(400).json({ success: false, error: 'Coupon code already exists' });
    const r = await query(
      `INSERT INTO coupons (code, discount_percent, new_price, course_id, created_at)
       VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
      [upperCode, discount_percent || null, new_price || null,
       course_id && course_id !== 'all' ? parseInt(course_id) : null]
    );
    return res.status(201).json({ success: true, coupon: r.rows[0] });
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ success: false, error: 'ID required' });
    await query('DELETE FROM coupons WHERE id=$1', [id]);
    return res.status(200).json({ success: true, message: 'Coupon deleted' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// ── PUBLIC: POST /api/purchases ─────────────────────────────────────
async function createPurchase(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  
  // Get user from session
  const token = req.cookies?.session_token;
  if (!token) return res.status(401).json({ success: false, error: 'Not authenticated' });
  
  const userResult = await query(
    `SELECT id FROM users WHERE session_token=$1 AND session_expires>NOW()`,
    [token]
  );
  if (!userResult.rows.length) return res.status(401).json({ success: false, error: 'Invalid or expired session' });
  
  const user = userResult.rows[0];
  const { course_id, sender_number, transaction_id, payment_method, coupon_code, coupon_price } = req.body || {};
  
  if (!course_id) return res.status(400).json({ success: false, error: 'Course ID required' });
  if (!sender_number) return res.status(400).json({ success: false, error: 'Sender number required' });
  if (!transaction_id) return res.status(400).json({ success: false, error: 'Transaction ID required' });
  
  // Verify course exists
  const courseResult = await query('SELECT id FROM courses WHERE id=$1', [course_id]);
  if (!courseResult.rows.length) return res.status(404).json({ success: false, error: 'Course not found' });

  // Insert purchase with pending status, including optional coupon info
  const result = await query(
    `INSERT INTO purchases (user_id, course_id, sender_number, transaction_id, payment_method, status, coupon_code, coupon_price)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7) RETURNING *`,
    [user.id, course_id, sender_number, transaction_id, payment_method || 'unknown',
     coupon_code ? coupon_code.toUpperCase().trim() : null, coupon_price || null]
  );
  
  return res.status(201).json({ success: true, purchase: result.rows[0] });
}

// ── USER: GET /api/user/purchases ───────────────────────────────────
async function userPurchases(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  
  // Get user from session
  const token = req.cookies?.session_token;
  if (!token) return res.status(401).json({ success: false, error: 'Not authenticated' });
  
  const userResult = await query(
    `SELECT id FROM users WHERE session_token=$1 AND session_expires>NOW()`,
    [token]
  );
  if (!userResult.rows.length) return res.status(401).json({ success: false, error: 'Invalid or expired session' });
  
  const user = userResult.rows[0];
  

  // Fetch purchases for this user, join with course details
  const r = await query(`
    SELECT p.*, c.title AS course_title, c.thumbnail_url, c.price, c.whatsapp
    FROM purchases p
    LEFT JOIN courses c ON p.course_id = c.id
    WHERE p.user_id = $1
    ORDER BY p.created_at DESC
  `, [user.id]);
  
  return res.status(200).json({ success: true, purchases: r.rows });
}

// ── ADMIN: GET/PUT /api/admin/purchases ─────────────────────────────
async function adminPurchases(req, res) {
  const admin = await requireStaff(req, res); if (!admin) return;


  if (req.method === 'GET') {
    // Fetch purchases and join with course and user tables to get titles and names
    const r = await query(`
      SELECT p.*, c.title AS course_title, u.username AS sender_name
      FROM purchases p
      LEFT JOIN courses c ON p.course_id = c.id
      LEFT JOIN users u ON p.user_id = u.id
      ORDER BY p.created_at DESC
    `);
    return res.status(200).json({ success: true, purchases: r.rows });
  }
  
  if (req.method === 'PUT') {
    const { id, status } = req.body || {};
    if (!id || !status) return res.status(400).json({ success: false, error: 'ID and status required' });
    
    // Update the purchase status
    await query('UPDATE purchases SET status = $1 WHERE id = $2', [status, id]);
    
    // If approved, automatically grant the user access to the course
    if (status === 'approved') {
      const p = await query('SELECT user_id, course_id FROM purchases WHERE id = $1', [id]);
      if (p.rows.length) {
        await query(`
          INSERT INTO user_courses (user_id, course_id, granted_by, granted_at)
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT (user_id, course_id) DO NOTHING
        `, [p.rows[0].user_id, p.rows[0].course_id, admin.id]);
      }
    }
    
    return res.status(200).json({ success: true, message: `Purchase ${status}` });
  }
  
  return res.status(405).json({ error: 'Method not allowed' });
}


// ── AUTH: POST /api/auth/register ─────────────────────────────────────────────
async function authRegister(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { username, email, password } = req.body || {};
  if (!username || !email || !password) return res.status(400).json({ success: false, error: 'username, email and password are required' });
  if (password.length < 8) return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return res.status(400).json({ success: false, error: 'Username must be 3-20 chars (letters, numbers, underscores)' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, error: 'Invalid email format' });

  const dup = await query('SELECT id FROM users WHERE email=$1 OR username=$2', [email.toLowerCase().trim(), username.toLowerCase().trim()]);
  if (dup.rows.length) return res.status(400).json({ success: false, error: 'Email or username already taken' });

  const passwordHash = await bcrypt.hash(password, 10);
  const verificationToken = uuidv4();
  const verificationExpires = new Date(Date.now() + 24*60*60*1000);

  const r = await query(
    `INSERT INTO users (username,email,password_hash,verification_token,verification_expires)
     VALUES ($1,$2,$3,$4,$5) RETURNING id,username,email,created_at,verified`,
    [username.toLowerCase().trim(), email.toLowerCase().trim(), passwordHash, verificationToken, verificationExpires]
  );
  return res.status(201).json({ success: true, message: 'Registration successful. Please verify your email.', user: r.rows[0] });
}

// ── AUTH: POST /api/auth/login ────────────────────────────────────────────────
async function authLogin(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ success: false, error: 'Email and password required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ success: false, error: 'Invalid email format' });

  const r = await query(
    'SELECT id,username,email,created_at,verified,password_hash,is_admin,role FROM users WHERE email=$1',
    [email.toLowerCase().trim()]
  );
  if (!r.rows.length) return res.status(400).json({ success: false, error: 'Invalid email or password' });
  const user = r.rows[0];

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(400).json({ success: false, error: 'Invalid email or password' });

  const sessionToken = crypto.randomBytes(32).toString('hex');
  const sessionExpires = new Date(Date.now() + 30*24*60*60*1000);
  await query('UPDATE users SET session_token=$1,session_expires=$2 WHERE id=$3', [sessionToken, sessionExpires, user.id]);

  const isStaff = user.is_admin === true || user.role === 'manager' || user.role === 'task_manager';
  res.setHeader('Set-Cookie', `session_token=${sessionToken}; HttpOnly; Path=/; Max-Age=${30*24*60*60}; SameSite=Strict`);
  return res.status(200).json({
    success: true, message: 'Login successful',
    user: { id: user.id, username: user.username, email: user.email, createdAt: user.created_at, verified: user.verified, isAdmin: user.is_admin === true, role: user.role || 'user' },
    redirectUrl: isStaff ? '/admin.html' : '/index.html'
  });
}

// ── AUTH: POST /api/auth/logout ───────────────────────────────────────────────
async function authLogout(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const match = (req.headers.cookie || '').match(/session_token=([^;]+)/);
  if (match) await query('UPDATE users SET session_token=NULL,session_expires=NULL WHERE session_token=$1', [match[1]]);
  res.setHeader('Set-Cookie', 'session_token=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict');
  return res.status(200).json({ success: true, message: 'Logout successful', loggedIn: false });
}

// ── AUTH: GET /api/auth/verify ────────────────────────────────────────────────
async function authVerify(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const match = (req.headers.cookie || '').match(/session_token=([^;]+)/);
  if (!match) return res.status(401).json({ success: false, error: 'No session', loggedIn: false });

  const r = await query(
    `SELECT id,username,email,created_at,verified,is_admin,role FROM users WHERE session_token=$1 AND session_expires>NOW()`,
    [match[1]]
  );
  if (!r.rows.length) return res.status(401).json({ success: false, error: 'Invalid or expired session', loggedIn: false });
  const u = r.rows[0];
  return res.status(200).json({
    success: true, loggedIn: true,
    user: { id: u.id, username: u.username, email: u.email, createdAt: u.created_at, verified: u.verified, isAdmin: u.is_admin === true, role: u.role || 'user' }
  });
}

// ── AUTH: POST /api/auth/forgot-password ──────────────────────────────────────
// ── AUTH: POST /api/auth/forgot-password ──────────────────────────────────────
async function authForgotPassword(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { email } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ success: false, error: 'Valid email required' });

  const r = await query('SELECT id,username,email FROM users WHERE email=$1', [email.toLowerCase().trim()]);
  
  // Return a distinct flag so the frontend can inform the user their email isn't registered
  if (!r.rows.length) return res.status(200).json({ success: true, noAccount: true, message: 'No account found with that email.' });

  const user = r.rows[0];
  const pin = Math.floor(100000 + Math.random() * 900000).toString();
  const pinExpires = new Date(Date.now() + 10*60*1000);

  await query(`CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(255) NOT NULL, expires_at TIMESTAMP NOT NULL, created_at TIMESTAMP DEFAULT NOW())`);
  await query('DELETE FROM password_reset_tokens WHERE user_id=$1', [user.id]);
  await query('INSERT INTO password_reset_tokens (user_id,token,expires_at) VALUES ($1,$2,$3)', [user.id, pin, pinExpires]);

  // Send via Brevo
  try {
    const brevoApiKey = process.env.BREVO_API_KEY;
    if (!brevoApiKey) {
      console.error('Brevo Error: BREVO_API_KEY env var is not set!');
      return res.status(500).json({ success: false, error: 'Email service is not configured. Please contact support.' });
    }

    const emailRes = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': brevoApiKey
      },
      body: JSON.stringify({
        sender: { name: 'DecentraForce', email: 'asikr048@gmail.com' },
        to: [{ email: email }],
        subject: 'Your Password Reset PIN',
        htmlContent: `
          <p>Hello <strong>${user.username}</strong>,</p>
          <p>You requested a password reset for <strong>DecentraForce</strong>.</p>
          <p>Your 6-digit reset PIN is: <strong style="font-size:24px;letter-spacing:4px">${pin}</strong></p>
          <p>This PIN expires in 10 minutes.</p>
          <p>If you did not request this, please ignore this email.</p>
          <p>Best regards,<br/>The DecentraForce Team</p>
        `
      })
    });

    const responseData = await emailRes.json();
    if (!emailRes.ok) {
      console.error('Brevo Failed — HTTP', emailRes.status, ':', JSON.stringify(responseData));
      const brevoError = responseData?.message || responseData?.error || 'Unknown email delivery error';
      return res.status(500).json({ 
        success: false, 
        error: `Brevo error (${emailRes.status}): ${brevoError}`
      });
    } else {
      console.log('Brevo Success — Message ID:', responseData.messageId);
    }
  } catch(e) {
    console.error('Network Error during Brevo fetch:', e.message);
    return res.status(500).json({ success: false, error: 'Network error sending email. Please try again.' });
  }

  return res.status(200).json({ success: true, message: 'Reset PIN sent successfully.' });
}

// ── AUTH: POST /api/auth/reset-password ───────────────────────────────────────

// ── AUTH: POST /api/auth/reset-password ───────────────────────────────────────
async function authResetPassword(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { email, pin, newPassword } = req.body || {};
  if (!email || !pin || pin.length !== 6 || !/^\d+$/.test(pin))
    return res.status(400).json({ success: false, error: 'Valid email and 6-digit PIN required' });

  const ur = await query('SELECT id FROM users WHERE email=$1', [email.toLowerCase().trim()]);
  if (!ur.rows.length) return res.status(404).json({ success: false, error: 'User not found' });
  const userId = ur.rows[0].id;

  const pr = await query(
    `SELECT id FROM password_reset_tokens WHERE user_id=$1 AND token=$2 AND expires_at>NOW() ORDER BY created_at DESC LIMIT 1`,
    [userId, pin]
  );
  if (!pr.rows.length) return res.status(400).json({ success: false, error: 'Invalid or expired PIN' });

  if (newPassword) {
    if (newPassword.length < 8) return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    const hash = await bcrypt.hash(newPassword, 10);
    await query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, userId]);
    await query('DELETE FROM password_reset_tokens WHERE id=$1', [pr.rows[0].id]);
    return res.status(200).json({ success: true, message: 'Password reset successfully.' });
  }
  return res.status(200).json({ success: true, verified: true, message: 'PIN verified.' });
}

// ── AUTH: GET /api/auth/verify-email ─────────────────────────────────────────
async function authVerifyEmail(req, res) {
  const { token } = req.query || {};
  if (!token) return res.status(400).json({ success: false, error: 'Token required' });
  const r = await query(
    `UPDATE users SET verified=TRUE,verification_token=NULL WHERE verification_token=$1 AND verification_expires>NOW() RETURNING id`,
    [token]
  );
  if (!r.rows.length) return res.status(400).json({ success: false, error: 'Invalid or expired token' });
  return res.status(200).json({ success: true, message: 'Email verified.' });
}

// ── ADMIN: GET /api/admin/init ────────────────────────────────────────────────
async function adminInit(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const pool = await getPool();
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user'`);
  await pool.query(`CREATE TABLE IF NOT EXISTS courses (
    id SERIAL PRIMARY KEY, title TEXT NOT NULL, description TEXT DEFAULT '',
    thumbnail_url TEXT DEFAULT '', video_url TEXT DEFAULT '', price NUMERIC DEFAULT 0,
    whatsapp VARCHAR(255), status VARCHAR(50) DEFAULT 'upcoming', sequence_order INT DEFAULT 9999,
    modules JSONB DEFAULT '{}', is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP)`);
  await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS price NUMERIC DEFAULT 0`);
  await pool.query(`ALTER TABLE courses ALTER COLUMN title TYPE TEXT`);
  await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS whatsapp VARCHAR(255)`);
  await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'upcoming'`);
  await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS sequence_order INT DEFAULT 9999`);
  await pool.query(`CREATE TABLE IF NOT EXISTS user_courses (
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
    granted_by INTEGER REFERENCES users(id),
    granted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id,course_id))`);
// ADD THIS BLOCK RIGHT HERE:
  await pool.query(`CREATE TABLE IF NOT EXISTS purchases (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
    sender_number VARCHAR(50) NOT NULL,
    transaction_id VARCHAR(100) NOT NULL,
    payment_method VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`);


  const ADMIN_EMAIL = 'asikrac@gmail.com', ADMIN_PASS = 'asikasik', ADMIN_NAME = 'Admin';
  const hash = await bcrypt.hash(ADMIN_PASS, 12);
  const ex = await pool.query('SELECT id FROM users WHERE email=$1', [ADMIN_EMAIL]);
  if (ex.rows.length) {
    await pool.query('UPDATE users SET password_hash=$1,is_admin=TRUE,verified=TRUE,username=$2 WHERE email=$3', [hash, ADMIN_NAME, ADMIN_EMAIL]);
  } else {
    await pool.query('INSERT INTO users (username,email,password_hash,is_admin,verified) VALUES ($1,$2,$3,TRUE,TRUE)', [ADMIN_NAME, ADMIN_EMAIL, hash]);
  }
  return res.status(200).json({ success: true, message: 'Setup complete. Login: asikrac@gmail.com / asikasik' });
}

// ── ADMIN: GET/POST/PUT/DELETE /api/admin/courses ─────────────────────────────
async function adminCourses(req, res) {
  // GET allowed for all staff; write operations (POST/PUT/DELETE) require manager or admin
  // requireManagerOrAbove/requireStaff already return the authenticated user — reuse it directly.
  let admin;
  if (req.method === 'GET') {
    admin = await requireStaff(req, res); if (!admin) return;
  } else {
    admin = await requireManagerOrAbove(req, res); if (!admin) return;
  }

  if (req.method === 'GET') {
    // Use left(thumbnail_url, 1) to cheaply detect base64 vs URL without transferring MB of data.
    // Base64 data URIs start with 'data:'; real URLs start with 'http'. We truncate base64 at
    // 500KB (enough for the admin preview) and return URLs as-is.
    const r = await query(`
      SELECT c.id,c.title,c.description,c.video_url,c.modules,c.is_active,c.created_at,
        c.price,c.discount_price,c.whatsapp,c.status,c.sequence_order,COALESCE(c.category,'General') AS category,
        CASE
          WHEN left(c.thumbnail_url,5)='data:' THEN left(c.thumbnail_url,500000)
          ELSE c.thumbnail_url
        END AS thumbnail_url,
        COUNT(uc.user_id)::int AS enrolled_count
      FROM courses c LEFT JOIN user_courses uc ON uc.course_id=c.id
      GROUP BY c.id ORDER BY COALESCE(c.sequence_order,9999),c.created_at DESC`);
    return res.status(200).json({ success: true, courses: r.rows });
  }
  if (req.method === 'POST') {
    const { title,description,thumbnail_url,video_url,price,discount_price,whatsapp,modules,is_active,status,sequence_order,category } = req.body||{};
    if (!title) return res.status(400).json({ success: false, error: 'Title required' });
    if (price==null) return res.status(400).json({ success: false, error: 'Price required' });
    if (!whatsapp) return res.status(400).json({ success: false, error: 'WhatsApp link required' });
    const r = await query(
      `INSERT INTO courses (title,description,thumbnail_url,video_url,price,discount_price,whatsapp,modules,is_active,status,sequence_order,category)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12) RETURNING *`,
      [title,description||'',thumbnail_url||'',video_url||'',price,discount_price||null,whatsapp,modules||'{}',is_active!==false,status||'upcoming',sequence_order??9999,(category||'General').trim()||'General']
    );
    return res.status(201).json({ success: true, course: r.rows[0] });
  }
  if (req.method === 'PUT') {
    const { id,title,description,thumbnail_url,video_url,price,discount_price,whatsapp,modules,is_active,status,sequence_order,category } = req.body||{};
    if (!id) return res.status(400).json({ success: false, error: 'ID required' });
    const r = await query(
      `UPDATE courses SET title=$1,description=$2,thumbnail_url=$3,video_url=$4,price=$5,discount_price=$6,whatsapp=$7,
       modules=$8::jsonb,is_active=$9,status=$10,sequence_order=$11,category=$12 WHERE id=$13 RETURNING *`,
      [title,description,thumbnail_url,video_url,price,discount_price||null,whatsapp,modules,is_active,status||'upcoming',sequence_order??9999,(category||'General').trim()||'General',id]
    );
    return res.status(200).json({ success: true, course: r.rows[0] });
  }
  if (req.method === 'DELETE') {
    const { id } = req.body||{};
    if (!id) return res.status(400).json({ success: false, error: 'ID required' });
    await query('DELETE FROM courses WHERE id=$1', [id]);
    return res.status(200).json({ success: true });
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

// ── ADMIN: GET /api/admin/users ───────────────────────────────────────────────
async function adminUsers(req, res) {
  const staff = await requireStaff(req, res); if (!staff) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const r = await query(`
    SELECT u.id,u.username,u.email,u.created_at,u.verified,u.is_admin,u.role,
      COALESCE(json_agg(json_build_object('course_id',uc.course_id,'title',c.title,'granted_at',uc.granted_at))
        FILTER (WHERE uc.course_id IS NOT NULL),'[]') AS courses
    FROM users u
    LEFT JOIN user_courses uc ON uc.user_id=u.id
    LEFT JOIN courses c ON c.id=uc.course_id
    GROUP BY u.id ORDER BY u.created_at DESC`);
  return res.status(200).json({ success: true, users: r.rows });
}

// ── ADMIN: POST/DELETE /api/admin/grant-access ────────────────────────────────
async function adminGrantAccess(req, res) {
  const admin = await requireStaff(req, res); if (!admin) return;
  const { user_id, course_id } = req.body||{};
  if (!user_id || !course_id) return res.status(400).json({ success: false, error: 'user_id and course_id required' });
  if (req.method === 'POST') {
    await query(`INSERT INTO user_courses (user_id,course_id,granted_by,granted_at) VALUES ($1,$2,$3,NOW())
      ON CONFLICT (user_id,course_id) DO NOTHING`, [user_id, course_id, admin.id]);
    return res.status(200).json({ success: true, message: 'Access granted' });
  }
  if (req.method === 'DELETE') {
    await query('DELETE FROM user_courses WHERE user_id=$1 AND course_id=$2', [user_id, course_id]);
    return res.status(200).json({ success: true, message: 'Access revoked' });
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

// ── USER: POST /api/user/update-profile ───────────────────────────────────────
async function userUpdateProfile(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const token = req.cookies?.session_token;
  if (!token) return res.status(401).json({ success: false, error: 'Not authenticated' });
  const userResult = await query(
    `SELECT id, username, email, password_hash FROM users WHERE session_token=$1 AND session_expires>NOW()`,
    [token]
  );
  if (!userResult.rows.length) return res.status(401).json({ success: false, error: 'Invalid or expired session' });
  const user = userResult.rows[0];
  const { type, newUsername, newEmail, currentPassword, newPassword } = req.body || {};

  if (type === 'profile') {
    if (!newUsername || newUsername.trim().length < 2)
      return res.status(400).json({ success: false, error: 'Display name must be at least 2 characters' });
    if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail))
      return res.status(400).json({ success: false, error: 'Valid email required' });
    const dup = await query('SELECT id FROM users WHERE email=$1 AND id!=$2', [newEmail.toLowerCase().trim(), user.id]);
    if (dup.rows.length) return res.status(400).json({ success: false, error: 'Email already in use by another account' });
    await query('UPDATE users SET username=$1, email=$2 WHERE id=$3', [newUsername.trim(), newEmail.toLowerCase().trim(), user.id]);
    return res.status(200).json({ success: true, message: 'Profile updated successfully' });
  }

  if (type === 'password') {
    if (!currentPassword || !newPassword || newPassword.length < 8)
      return res.status(400).json({ success: false, error: 'Current password and new password (min 8 characters) required' });
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) return res.status(400).json({ success: false, error: 'Current password is incorrect' });
    await query('UPDATE users SET password_hash=$1 WHERE id=$2', [await bcrypt.hash(newPassword, 10), user.id]);
    return res.status(200).json({ success: true, message: 'Password updated successfully' });
  }

  return res.status(400).json({ success: false, error: 'Invalid update type' });
}

// ── ADMIN: POST /api/admin/set-role ──────────────────────────────────────────
// Admin can set/remove 'manager' or 'task_manager'.
// Manager can only set/remove 'task_manager' (cannot touch 'manager' roles).
async function adminSetRole(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const staff = await requireStaff(req, res); if (!staff) return;

  const { user_id, role } = req.body || {};
  if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });

  // Valid role values: 'manager', 'task_manager', or 'user' (to remove role)
  const validRoles = ['manager', 'task_manager', 'user'];
  if (!validRoles.includes(role)) return res.status(400).json({ success: false, error: 'Invalid role. Use: manager, task_manager, or user' });

  // Fetch the target user
  const targetR = await query('SELECT id, username, email, is_admin, role FROM users WHERE id=$1', [user_id]);
  if (!targetR.rows.length) return res.status(404).json({ success: false, error: 'User not found' });
  const target = targetR.rows[0];

  // Cannot modify super-admin
  if (target.is_admin) return res.status(403).json({ success: false, error: 'Cannot change the super admin role' });

  // Cannot modify yourself
  if (target.id === staff.id) return res.status(403).json({ success: false, error: 'Cannot change your own role' });

  // Manager restriction: cannot set or remove 'manager' role — only admin can
  if (!staff.is_admin && (role === 'manager' || target.role === 'manager')) {
    return res.status(403).json({ success: false, error: 'Only the super admin can assign or remove the Manager role' });
  }

  await query("UPDATE users SET role=$1 WHERE id=$2", [role, user_id]);
  return res.status(200).json({ success: true, message: `Role updated to '${role}' for ${target.username}` });
}


// ── ADMIN: POST /api/admin/update-profile ─────────────────────────────────────
async function adminUpdateProfile(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const admin = await requireAdmin(req, res); if (!admin) return;
  const { type, newEmail, currentPassword, newPassword } = req.body||{};
  if (type === 'email') {
    if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) return res.status(400).json({ success: false, error: 'Valid email required' });
    const dup = await query('SELECT id FROM users WHERE email=$1 AND id!=$2', [newEmail, admin.id]);
    if (dup.rows.length) return res.status(400).json({ success: false, error: 'Email already in use' });
    await query('UPDATE users SET email=$1 WHERE id=$2', [newEmail.toLowerCase().trim(), admin.id]);
    return res.status(200).json({ success: true, message: 'Email updated' });
  }
  if (type === 'password') {
    if (!currentPassword || !newPassword || newPassword.length < 8)
      return res.status(400).json({ success: false, error: 'Current password and new password (8+ chars) required' });
    const valid = await bcrypt.compare(currentPassword, admin.password_hash);
    if (!valid) return res.status(400).json({ success: false, error: 'Current password incorrect' });
    await query('UPDATE users SET password_hash=$1 WHERE id=$2', [await bcrypt.hash(newPassword, 12), admin.id]);
    return res.status(200).json({ success: true, message: 'Password updated' });
  }
  return res.status(400).json({ success: false, error: 'Invalid type' });
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC: MENTORS
// ═══════════════════════════════════════════════════════════════════════════════
async function publicMentors(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });
  try {
    const result = await query(`SELECT * FROM mentors WHERE is_active = TRUE ORDER BY sort_order ASC, id ASC`);
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=120, stale-while-revalidate=600');
    return res.status(200).json({ success: true, mentors: result.rows });
  } catch (error) {
    console.error('Public Mentors API Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC: TESTIMONIALS
// ═══════════════════════════════════════════════════════════════════════════════
async function publicTestimonials(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });
  try {
    const result = await query(`SELECT * FROM testimonials WHERE is_active = TRUE ORDER BY sort_order ASC, id ASC`);
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=120, stale-while-revalidate=600');
    return res.status(200).json({ success: true, testimonials: result.rows });
  } catch (error) {
    console.error('Public Testimonials API Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN: MENTORS
// ═══════════════════════════════════════════════════════════════════════════════
async function adminMentors(req, res) {
  const admin = await requireStaff(req, res); if (!admin) return;
  try {
    if (req.method === 'GET') {
      const result = await query(`SELECT * FROM mentors ORDER BY sort_order ASC, id ASC`);
      return res.status(200).json({ success: true, mentors: result.rows });
    }
    if (req.method === 'POST') {
      const { name_bn, name_en, title_bn, title_en, bio_bn, bio_en, image_url, twitter_url, linkedin_url, github_url, is_active, sort_order } = req.body||{};
      if (!name_bn || !name_en) return res.status(400).json({ success: false, error: 'name_bn and name_en are required' });
      let finalSort = sort_order;
      if (finalSort === undefined || finalSort === null) {
        const mx = await query('SELECT COALESCE(MAX(sort_order), 0) as m FROM mentors');
        finalSort = mx.rows[0].m + 1;
      }
      const result = await query(
        `INSERT INTO mentors (name_bn,name_en,title_bn,title_en,bio_bn,bio_en,image_url,twitter_url,linkedin_url,github_url,is_active,sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [name_bn,name_en,title_bn||'',title_en||'',bio_bn||'',bio_en||'',image_url||'',twitter_url||'',linkedin_url||'',github_url||'',is_active!==false,finalSort]
      );
      return res.status(201).json({ success: true, mentor: result.rows[0] });
    }
    if (req.method === 'PUT') {
      const { id, name_bn, name_en, title_bn, title_en, bio_bn, bio_en, image_url, twitter_url, linkedin_url, github_url, is_active, sort_order } = req.body||{};
      if (!id) return res.status(400).json({ success: false, error: 'Mentor ID required' });
      if (!name_bn || !name_en) return res.status(400).json({ success: false, error: 'name_bn and name_en are required' });
      const result = await query(
        `UPDATE mentors SET name_bn=$1,name_en=$2,title_bn=$3,title_en=$4,bio_bn=$5,bio_en=$6,
         image_url=$7,twitter_url=$8,linkedin_url=$9,github_url=$10,is_active=$11,sort_order=$12 WHERE id=$13 RETURNING *`,
        [name_bn,name_en,title_bn||'',title_en||'',bio_bn||'',bio_en||'',image_url||'',twitter_url||'',linkedin_url||'',github_url||'',is_active!==false,sort_order||0,id]
      );
      return res.status(200).json({ success: true, mentor: result.rows[0] });
    }
    if (req.method === 'DELETE') {
      const { id } = req.body||{};
      if (!id) return res.status(400).json({ success: false, error: 'Mentor ID required' });
      await query('DELETE FROM mentors WHERE id=$1', [id]);
      return res.status(200).json({ success: true, message: 'Mentor deleted' });
    }
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('Admin Mentors API Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN: TESTIMONIALS
// ═══════════════════════════════════════════════════════════════════════════════
async function adminTestimonials(req, res) {
  const admin = await requireStaff(req, res); if (!admin) return;
  try {
    if (req.method === 'GET') {
      const result = await query(`SELECT * FROM testimonials ORDER BY sort_order ASC, id ASC`);
      return res.status(200).json({ success: true, testimonials: result.rows });
    }
    if (req.method === 'POST') {
      const { name_bn, name_en, role_bn, role_en, text_bn, text_en, rating, image_url, is_active, sort_order } = req.body||{};
      if (!name_bn || !name_en || !text_bn || !text_en) return res.status(400).json({ success: false, error: 'name_bn, name_en, text_bn, text_en are required' });
      let finalSort = sort_order;
      if (finalSort === undefined || finalSort === null) {
        const mx = await query('SELECT COALESCE(MAX(sort_order), 0) as m FROM testimonials');
        finalSort = mx.rows[0].m + 1;
      }
      const result = await query(
        `INSERT INTO testimonials (name_bn,name_en,role_bn,role_en,text_bn,text_en,rating,image_url,is_active,sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [name_bn,name_en,role_bn||'',role_en||'',text_bn,text_en,rating||5,image_url||'',is_active!==false,finalSort]
      );
      return res.status(201).json({ success: true, testimonial: result.rows[0] });
    }
    if (req.method === 'PUT') {
      const { id, name_bn, name_en, role_bn, role_en, text_bn, text_en, rating, image_url, is_active, sort_order } = req.body||{};
      if (!id) return res.status(400).json({ success: false, error: 'Testimonial ID required' });
      if (!name_bn || !name_en || !text_bn || !text_en) return res.status(400).json({ success: false, error: 'name_bn, name_en, text_bn, text_en are required' });
      const result = await query(
        `UPDATE testimonials SET name_bn=$1,name_en=$2,role_bn=$3,role_en=$4,text_bn=$5,text_en=$6,
         rating=$7,image_url=$8,is_active=$9,sort_order=$10 WHERE id=$11 RETURNING *`,
        [name_bn,name_en,role_bn||'',role_en||'',text_bn,text_en,rating||5,image_url||'',is_active!==false,sort_order||0,id]
      );
      return res.status(200).json({ success: true, testimonial: result.rows[0] });
    }
    if (req.method === 'DELETE') {
      const { id } = req.body||{};
      if (!id) return res.status(400).json({ success: false, error: 'Testimonial ID required' });
      await query('DELETE FROM testimonials WHERE id=$1', [id]);
      return res.status(200).json({ success: true, message: 'Testimonial deleted' });
    }
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('Admin Testimonials API Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN: EXAMS  (MCQ or link-based, per course)
// ═══════════════════════════════════════════════════════════════════════════════
async function adminExams(req, res) {
  const admin = await requireStaff(req, res); if (!admin) return;

  // Ensure tables exist
  await query(`CREATE TABLE IF NOT EXISTS exams (
    id SERIAL PRIMARY KEY,
    course_id INTEGER NOT NULL,
    title VARCHAR(255) NOT NULL,
    type VARCHAR(20) NOT NULL DEFAULT 'mcq',   -- 'mcq' | 'link'
    link_url TEXT,
    total_marks INTEGER NOT NULL DEFAULT 100,
    duration_minutes INTEGER DEFAULT 60,
    questions JSONB DEFAULT '[]'::jsonb,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`);

  if (req.method === 'GET') {
    const { course_id } = req.query || {};
    let r;
    if (course_id) {
      r = await query(`SELECT * FROM exams WHERE course_id=$1 ORDER BY created_at DESC`, [course_id]);
    } else {
      r = await query(`SELECT * FROM exams ORDER BY created_at DESC`);
    }
    return res.status(200).json({ success: true, exams: r.rows });
  }

  if (req.method === 'POST') {
    const { course_id, title, type, link_url, total_marks, duration_minutes, questions,
            pass_marks, max_attempts, shuffle_questions, shuffle_options, questions_per_attempt, show_answers } = req.body || {};
    if (!course_id || !title) return res.status(400).json({ success: false, error: 'course_id and title required' });
    const r = await query(
      `INSERT INTO exams (course_id, title, type, link_url, total_marks, duration_minutes, questions,
         pass_marks, max_attempts, shuffle_questions, shuffle_options, questions_per_attempt, show_answers)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [course_id, title, type||'mcq', link_url||null, total_marks||100, duration_minutes||60, JSON.stringify(questions||[]),
       pass_marks ?? null, max_attempts ?? 1, !!shuffle_questions, !!shuffle_options, questions_per_attempt || null, show_answers !== false]
    );
    return res.status(200).json({ success: true, exam: r.rows[0] });
  }

  if (req.method === 'PUT') {
    const { id, title, type, link_url, total_marks, duration_minutes, questions, is_active,
            pass_marks, max_attempts, shuffle_questions, shuffle_options, questions_per_attempt, show_answers } = req.body || {};
    if (!id) return res.status(400).json({ success: false, error: 'id required' });
    const r = await query(
      `UPDATE exams SET title=$1, type=$2, link_url=$3, total_marks=$4, duration_minutes=$5, questions=$6, is_active=$7,
         pass_marks=$8, max_attempts=$9, shuffle_questions=$10, shuffle_options=$11, questions_per_attempt=$12, show_answers=$13
       WHERE id=$14 RETURNING *`,
      [title, type||'mcq', link_url||null, total_marks||100, duration_minutes||60, JSON.stringify(questions||[]), is_active!==false,
       pass_marks ?? null, max_attempts ?? 1, !!shuffle_questions, !!shuffle_options, questions_per_attempt || null, show_answers !== false, id]
    );
    return res.status(200).json({ success: true, exam: r.rows[0] });
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ success: false, error: 'id required' });
    await query(`DELETE FROM exams WHERE id=$1`, [id]);
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC: GET exam for a course (without answers)
// ═══════════════════════════════════════════════════════════════════════════════
// Fisher-Yates shuffle (returns a new array).
function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Strip a stored question down to what the learner is allowed to see (no answers).
function sanitizeQuestion(q) {
  const out = { id: q.id, type: q.type || 'mcq', question: q.question, marks: q.marks || 1 };
  if (['mcq', 'multi', 'truefalse'].includes(out.type)) {
    out.options = Array.isArray(q.options) ? q.options : [];
  }
  if (out.type === 'fill') out.blanks = Array.isArray(q.accepted) ? q.accepted.length : 1;
  if (out.type === 'code') {
    out.language = q.language || 'javascript';
    out.starter_code = q.starter_code || '';
    // Visible tests so the learner can run them; the grader re-checks server-side too.
    out.tests = (Array.isArray(q.tests) ? q.tests : []).map(t => ({ input: t.input ?? '', expected: t.expected ?? '' }));
  }
  return out;
}

async function publicExam(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const { course_id } = req.query || {};
  if (!course_id) return res.status(400).json({ success: false, error: 'course_id required' });

  const r = await query(
    `SELECT * FROM exams WHERE course_id=$1 AND is_active=TRUE ORDER BY created_at DESC LIMIT 1`,
    [course_id]
  );
  if (!r.rows.length) return res.status(200).json({ success: true, exam: null });
  const e = r.rows[0];

  let questions = [];
  if (e.type !== 'link') {
    let all = Array.isArray(e.questions) ? e.questions : JSON.parse(e.questions || '[]');
    if (e.shuffle_questions) all = shuffled(all);
    if (e.questions_per_attempt && e.questions_per_attempt > 0 && e.questions_per_attempt < all.length) {
      all = (e.shuffle_questions ? all : shuffled(all)).slice(0, e.questions_per_attempt);
    }
    questions = all.map(sanitizeQuestion);
    if (e.shuffle_options) {
      questions = questions.map(q => q.options
        ? { ...q, options: q.options.map((text, idx) => ({ text, idx })) } // keep original index as value
        : q);
    }
  }

  // If the request carries a valid session, report how many attempts this user has used.
  let attemptsUsed = 0;
  const token = req.cookies?.session_token;
  if (token) {
    try {
      const ur = await query(`SELECT id FROM users WHERE session_token=$1 AND session_expires>NOW()`, [token]);
      if (ur.rows.length) {
        const ar = await query(`SELECT COUNT(*)::int AS n FROM exam_attempts WHERE user_id=$1 AND exam_id=$2`, [ur.rows[0].id, e.id]);
        attemptsUsed = ar.rows[0].n;
      }
    } catch(_) { /* exam_attempts may not exist yet on first boot */ }
  }

  return res.status(200).json({ success: true, exam: {
    id: e.id, course_id: e.course_id, title: e.title, type: e.type, link_url: e.link_url,
    total_marks: e.total_marks, duration_minutes: e.duration_minutes,
    pass_marks: e.pass_marks, max_attempts: e.max_attempts ?? 1, attempts_used: attemptsUsed,
    shuffle_options: !!e.shuffle_options, show_answers: e.show_answers !== false,
    questions
  }});
}

// ═══════════════════════════════════════════════════════════════════════════════
// USER: SUBMIT MCQ EXAM
// ═══════════════════════════════════════════════════════════════════════════════
async function submitExam(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const token = req.cookies?.session_token;
  if (!token) return res.status(401).json({ success: false, error: 'Not authenticated' });
  const userResult = await query(`SELECT id, username FROM users WHERE session_token=$1 AND session_expires>NOW()`, [token]);
  if (!userResult.rows.length) return res.status(401).json({ success: false, error: 'Invalid session' });
  const user = userResult.rows[0];

  const { exam_id, answers } = req.body || {};
  if (!exam_id || !answers) return res.status(400).json({ success: false, error: 'exam_id and answers required' });

  // Ensure table exists with a single consistent schema (no unique constraints)
  await query(`CREATE TABLE IF NOT EXISTS user_marks (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    course_id INTEGER NOT NULL,
    exam_id INTEGER,
    type VARCHAR(30) NOT NULL DEFAULT 'assignment',
    label VARCHAR(255) DEFAULT 'Assignment',
    marks_obtained NUMERIC(8,2) NOT NULL DEFAULT 0,
    total_marks NUMERIC(8,2) NOT NULL DEFAULT 100,
    notes TEXT,
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`);
  // Drop any legacy unique constraints that may exist from earlier schema
  try {
    await query(`ALTER TABLE user_marks DROP CONSTRAINT IF EXISTS user_marks_user_id_exam_id_type_key`);
    await query(`ALTER TABLE user_marks DROP CONSTRAINT IF EXISTS user_marks_user_id_course_id_label_type_key`);
  } catch(e) { /* ignore */ }

  await query(`CREATE TABLE IF NOT EXISTS exam_attempts (
    id SERIAL PRIMARY KEY, user_id INTEGER, exam_id INTEGER, course_id INTEGER,
    attempt_no INTEGER NOT NULL DEFAULT 1, score NUMERIC(8,2) NOT NULL DEFAULT 0,
    total NUMERIC(8,2) NOT NULL DEFAULT 0, passed BOOLEAN DEFAULT FALSE,
    answers JSONB DEFAULT '{}'::jsonb, created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`);

  const examResult = await query(`SELECT * FROM exams WHERE id=$1`, [exam_id]);
  if (!examResult.rows.length) return res.status(404).json({ success: false, error: 'Exam not found' });
  const exam = examResult.rows[0];
  const allQuestions = Array.isArray(exam.questions) ? exam.questions : JSON.parse(exam.questions || '[]');

  // Enforce attempt limit (0 / null = unlimited)
  const maxAttempts = exam.max_attempts ?? 1;
  const priorR = await query(`SELECT COUNT(*)::int AS n FROM exam_attempts WHERE user_id=$1 AND exam_id=$2`, [user.id, exam_id]);
  const priorCount = priorR.rows[0].n;
  if (maxAttempts && maxAttempts > 0 && priorCount >= maxAttempts) {
    return res.status(403).json({ success: false, error: `No attempts remaining (used ${priorCount} of ${maxAttempts}).` });
  }

  // Grade only the questions that were presented to this learner.
  const presentedIds = Array.isArray(req.body.question_ids) && req.body.question_ids.length
    ? req.body.question_ids.map(String)
    : allQuestions.map(q => String(q.id));
  const graded = allQuestions.filter(q => presentedIds.includes(String(q.id)));

  const norm = s => String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
  let score = 0, totalPossible = 0;
  const feedback = [];

  graded.forEach(q => {
    const marks = q.marks || 1;
    totalPossible += marks;
    const ua = answers[q.id];
    let earned = 0, correct = false;

    switch (q.type || 'mcq') {
      case 'mcq':
      case 'truefalse':
        correct = ua != null && Number(ua) === Number(q.correct_answer);
        if (correct) earned = marks;
        break;
      case 'multi': {
        const want = (Array.isArray(q.correct_answers) ? q.correct_answers : []).map(Number).sort();
        const got  = (Array.isArray(ua) ? ua : []).map(Number).sort();
        correct = want.length > 0 && want.length === got.length && want.every((v, i) => v === got[i]);
        if (correct) earned = marks;
        break;
      }
      case 'short': {
        const accepted = (Array.isArray(q.accepted) ? q.accepted : []).map(norm);
        correct = accepted.includes(norm(ua));
        if (correct) earned = marks;
        break;
      }
      case 'fill': {
        const accepted = Array.isArray(q.accepted) ? q.accepted : [];
        const arr = Array.isArray(ua) ? ua : [ua];
        let hit = 0;
        accepted.forEach((acc, i) => {
          const allowed = String(acc).split('|').map(norm); // "a|b" = either accepted
          if (allowed.includes(norm(arr[i]))) hit++;
        });
        earned = accepted.length ? marks * (hit / accepted.length) : 0;
        correct = accepted.length > 0 && hit === accepted.length;
        break;
      }
      case 'code': {
        // Client runs the JS tests in a sandboxed worker and reports pass/total.
        const passed = Math.max(0, parseInt(ua?.passed) || 0);
        const tot    = Math.max(passed, parseInt(ua?.total) || (Array.isArray(q.tests) ? q.tests.length : 0));
        earned = tot ? marks * (passed / tot) : 0;
        correct = tot > 0 && passed === tot;
        break;
      }
    }

    earned = Math.round(earned * 100) / 100;
    score += earned;
    feedback.push({
      id: q.id, type: q.type || 'mcq', correct, earned, marks,
      // Only reveal answer keys when the exam allows it
      ...(exam.show_answers !== false ? {
        correct_answer: q.correct_answer, correct_answers: q.correct_answers,
        accepted: q.accepted, explanation: q.explanation || ''
      } : {}),
      user_answer: ua
    });
  });

  score = Math.round(score * 100) / 100;
  const passMark = exam.pass_marks ?? null;
  const passed = passMark != null ? score >= passMark : null;
  const attemptNo = priorCount + 1;

  await query(
    `INSERT INTO exam_attempts (user_id, exam_id, course_id, attempt_no, score, total, passed, answers)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [user.id, exam_id, exam.course_id, attemptNo, score, totalPossible, !!passed, JSON.stringify(answers || {})]
  );

  // Keep the BEST attempt in user_marks (drives the leaderboard).
  const existing = await query(
    `SELECT id, marks_obtained FROM user_marks WHERE user_id=$1 AND exam_id=$2 AND type='exam'`,
    [user.id, exam_id]
  );
  if (existing.rows.length > 0) {
    if (score > parseFloat(existing.rows[0].marks_obtained)) {
      await query(`UPDATE user_marks SET marks_obtained=$1, total_marks=$2, submitted_at=NOW() WHERE id=$3`,
        [score, totalPossible, existing.rows[0].id]);
    }
  } else {
    await query(
      `INSERT INTO user_marks (user_id, course_id, exam_id, type, label, marks_obtained, total_marks)
       VALUES ($1,$2,$3,'exam',$4,$5,$6)`,
      [user.id, exam.course_id, exam_id, exam.title, score, totalPossible]
    );
  }

  const attemptsLeft = (maxAttempts && maxAttempts > 0) ? Math.max(0, maxAttempts - attemptNo) : null;
  return res.status(200).json({
    success: true, score, total: totalPossible, feedback,
    passed, pass_marks: passMark, attempt_no: attemptNo, attempts_left: attemptsLeft,
    show_answers: exam.show_answers !== false
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN: MARKS — assign assignment marks to users
// ═══════════════════════════════════════════════════════════════════════════════
async function adminMarks(req, res) {
  const admin = await requireStaff(req, res); if (!admin) return;

  await query(`CREATE TABLE IF NOT EXISTS user_marks (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    course_id INTEGER NOT NULL,
    exam_id INTEGER,
    type VARCHAR(30) NOT NULL DEFAULT 'assignment',
    label VARCHAR(255) DEFAULT 'Assignment',
    marks_obtained NUMERIC(8,2) NOT NULL DEFAULT 0,
    total_marks NUMERIC(8,2) NOT NULL DEFAULT 100,
    notes TEXT,
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`);
  try {
    await query(`ALTER TABLE user_marks DROP CONSTRAINT IF EXISTS user_marks_user_id_exam_id_type_key`);
    await query(`ALTER TABLE user_marks DROP CONSTRAINT IF EXISTS user_marks_user_id_course_id_label_type_key`);
  } catch(e) { /* ignore */ }

  if (req.method === 'GET') {
    const { course_id } = req.query || {};
    if (!course_id) return res.status(400).json({ success: false, error: 'course_id required' });
    const r = await query(
      `SELECT um.*, u.username, u.email
       FROM user_marks um
       JOIN users u ON u.id = um.user_id
       WHERE um.course_id=$1
       ORDER BY um.submitted_at DESC`,
      [course_id]
    );
    // Get ALL users so admin can assign marks to anyone
    const allUsers = await query(
      `SELECT u.id, u.username, u.email FROM users u WHERE u.is_admin=FALSE AND (u.role IS NULL OR u.role='user') ORDER BY u.username`
    );
    return res.status(200).json({ success: true, marks: r.rows, enrolled_users: allUsers.rows });
  }

  if (req.method === 'POST') {
    const { user_id, course_id, label, marks_obtained, total_marks, notes } = req.body || {};
    if (!user_id || !course_id || marks_obtained === undefined) return res.status(400).json({ success: false, error: 'user_id, course_id, marks_obtained required' });
    const r = await query(
      `INSERT INTO user_marks (user_id, course_id, type, label, marks_obtained, total_marks, notes)
       VALUES ($1,$2,'assignment',$3,$4,$5,$6)
       RETURNING *`,
      [user_id, course_id, label||'Assignment', marks_obtained, total_marks||100, notes||null]
    );
    return res.status(200).json({ success: true, mark: r.rows[0] });
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ success: false, error: 'id required' });
    await query(`DELETE FROM user_marks WHERE id=$1`, [id]);
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

// ═══════════════════════════════════════════════════════════════════════════════
// USER: GET OWN MARKS for a course
// ═══════════════════════════════════════════════════════════════════════════════
async function userMarks(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const token = req.cookies?.session_token;
  if (!token) return res.status(401).json({ success: false, error: 'Not authenticated' });
  const userResult = await query(`SELECT id FROM users WHERE session_token=$1 AND session_expires>NOW()`, [token]);
  if (!userResult.rows.length) return res.status(401).json({ success: false, error: 'Invalid session' });
  const user = userResult.rows[0];
  const { course_id } = req.query || {};
  if (!course_id) return res.status(400).json({ success: false, error: 'course_id required' });

  const r = await query(
    `SELECT * FROM user_marks WHERE user_id=$1 AND course_id=$2 ORDER BY submitted_at DESC`,
    [user.id, course_id]
  );
  return res.status(200).json({ success: true, marks: r.rows });
}


// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN: DB-BACKED ASSIGNMENTS (stored in course modules JSON)
// ═══════════════════════════════════════════════════════════════════════════════
async function adminAssignmentsCrud(req, res) {
  const admin = await requireStaff(req, res); if (!admin) return;

  if (req.method === 'POST') {
    const { course_id, title, description, due_date, max_marks } = req.body || {};
    if (!course_id || !title) return res.status(400).json({ success: false, error: 'course_id and title required' });
    const cr = await query(`SELECT modules FROM courses WHERE id=$1`, [course_id]);
    if (!cr.rows.length) return res.status(404).json({ success: false, error: 'Course not found' });
    let mods = {};
    try { mods = typeof cr.rows[0].modules === 'string' ? JSON.parse(cr.rows[0].modules) : (cr.rows[0].modules || {}); } catch(e) {}
    if (!Array.isArray(mods.assignments_list)) mods.assignments_list = [];
    const newAssignment = { id: Date.now().toString(), title, description: description||'', due_date: due_date||null, max_marks: max_marks||100, created_at: new Date().toISOString() };
    mods.assignments_list.push(newAssignment);
    await query(`UPDATE courses SET modules=$1::jsonb WHERE id=$2`, [JSON.stringify(mods), course_id]);
    return res.status(200).json({ success: true, assignment: newAssignment, assignments: mods.assignments_list });
  }

  if (req.method === 'DELETE') {
    const { course_id, assignment_id } = req.body || {};
    if (!course_id || !assignment_id) return res.status(400).json({ success: false, error: 'course_id and assignment_id required' });
    const cr = await query(`SELECT modules FROM courses WHERE id=$1`, [course_id]);
    if (!cr.rows.length) return res.status(404).json({ success: false, error: 'Course not found' });
    let mods = {};
    try { mods = typeof cr.rows[0].modules === 'string' ? JSON.parse(cr.rows[0].modules) : (cr.rows[0].modules || {}); } catch(e) {}
    if (!Array.isArray(mods.assignments_list)) mods.assignments_list = [];
    mods.assignments_list = mods.assignments_list.filter(a => a.id !== assignment_id);
    await query(`UPDATE courses SET modules=$1::jsonb WHERE id=$2`, [JSON.stringify(mods), course_id]);
    return res.status(200).json({ success: true, assignments: mods.assignments_list });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

// ═══════════════════════════════════════════════════════════════════════════════
// USER: ASSIGNMENT SUBMISSIONS — GET own / POST submit
// ═══════════════════════════════════════════════════════════════════════════════
async function userSubmissions(req, res) {
  const user = await requireUser(req, res); if (!user) return;

  if (req.method === 'GET') {
    const courseId = parseInt((req.query?.course_id) || (req.url.split('course_id=')[1] || '').split('&')[0]);
    if (!courseId) return res.status(400).json({ success: false, error: 'course_id required' });
    const r = await query(
      `SELECT id, assignment_id, assignment_title, submission_text, submission_url, file_name,
              status, marks_obtained, max_marks, feedback, submitted_at, graded_at
       FROM assignment_submissions WHERE user_id=$1 AND course_id=$2`,
      [user.id, courseId]
    );
    return res.status(200).json({ success: true, submissions: r.rows });
  }

  if (req.method === 'POST') {
    const { course_id, assignment_id, submission_text, submission_url, file_data, file_name } = req.body || {};
    if (!course_id || !assignment_id) return res.status(400).json({ success: false, error: 'course_id and assignment_id required' });
    if (!(await isEnrolled(user.id, course_id))) return res.status(403).json({ success: false, error: 'Not enrolled in this course' });
    if (!(submission_text || '').trim() && !(submission_url || '').trim() && !file_data) {
      return res.status(400).json({ success: false, error: 'Provide text, a link, or a file' });
    }
    if (file_data && file_data.length > 2_800_000) { // ~2MB after base64 overhead
      return res.status(413).json({ success: false, error: 'File too large (max ~2 MB). Please upload a link instead.' });
    }

    // Look up the assignment title / max marks from the course modules.
    let title = '', maxMarks = null;
    const cr = await query(`SELECT modules FROM courses WHERE id=$1`, [course_id]);
    if (cr.rows.length) {
      let mods = {};
      try { mods = typeof cr.rows[0].modules === 'string' ? JSON.parse(cr.rows[0].modules) : (cr.rows[0].modules || {}); } catch(e) {}
      const a = (Array.isArray(mods.assignments_list) ? mods.assignments_list : []).find(x => String(x.id) === String(assignment_id));
      if (a) { title = a.title || ''; maxMarks = a.max_marks ?? null; }
    }

    // Resubmission resets grading status.
    const r = await query(`
      INSERT INTO assignment_submissions
        (user_id, course_id, assignment_id, assignment_title, submission_text, submission_url, file_data, file_name, max_marks, status, submitted_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'submitted',NOW())
      ON CONFLICT (user_id, assignment_id) DO UPDATE SET
        submission_text=EXCLUDED.submission_text, submission_url=EXCLUDED.submission_url,
        file_data=EXCLUDED.file_data, file_name=EXCLUDED.file_name,
        status='submitted', submitted_at=NOW(), marks_obtained=NULL, graded_at=NULL
      RETURNING id, assignment_id, status, submitted_at
    `, [user.id, course_id, assignment_id, title, (submission_text||'').slice(0,10000), (submission_url||'').slice(0,1000),
        file_data || null, (file_name||'').slice(0,200), maxMarks]);
    return res.status(200).json({ success: true, submission: r.rows[0] });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN: SUBMISSIONS REVIEW QUEUE — GET list / PUT grade
// ═══════════════════════════════════════════════════════════════════════════════
async function adminSubmissions(req, res) {
  const admin = await requireStaff(req, res); if (!admin) return;

  if (req.method === 'GET') {
    const { course_id } = req.query || {};
    const params = [];
    let where = '';
    if (course_id) { params.push(course_id); where = `WHERE s.course_id=$1`; }
    const r = await query(`
      SELECT s.id, s.user_id, s.course_id, s.assignment_id, s.assignment_title,
             s.submission_text, s.submission_url, s.file_data, s.file_name,
             s.status, s.marks_obtained, s.max_marks, s.feedback, s.submitted_at, s.graded_at,
             u.username, u.email, c.title AS course_title
      FROM assignment_submissions s
      JOIN users u ON u.id = s.user_id
      JOIN courses c ON c.id = s.course_id
      ${where} ORDER BY (s.status='submitted') DESC, s.submitted_at DESC`, params);
    return res.status(200).json({ success: true, submissions: r.rows });
  }

  if (req.method === 'PUT') {
    const { id, marks_obtained, feedback } = req.body || {};
    if (!id || marks_obtained == null) return res.status(400).json({ success: false, error: 'id and marks_obtained required' });
    const sr = await query(`SELECT * FROM assignment_submissions WHERE id=$1`, [id]);
    if (!sr.rows.length) return res.status(404).json({ success: false, error: 'Submission not found' });
    const sub = sr.rows[0];
    const max = sub.max_marks ?? marks_obtained;

    await query(
      `UPDATE assignment_submissions SET marks_obtained=$1, feedback=$2, status='graded', graded_at=NOW() WHERE id=$3`,
      [marks_obtained, (feedback||'').slice(0,2000), id]
    );

    // Mirror the grade into user_marks so it counts on the leaderboard / marks view.
    const label = sub.assignment_title || 'Assignment';
    const ex = await query(
      `SELECT id FROM user_marks WHERE user_id=$1 AND course_id=$2 AND type='assignment' AND label=$3`,
      [sub.user_id, sub.course_id, label]
    );
    if (ex.rows.length) {
      await query(`UPDATE user_marks SET marks_obtained=$1, total_marks=$2, notes=$3, submitted_at=NOW() WHERE id=$4`,
        [marks_obtained, max, (feedback||'').slice(0,500), ex.rows[0].id]);
    } else {
      await query(`INSERT INTO user_marks (user_id, course_id, type, label, marks_obtained, total_marks, notes)
        VALUES ($1,$2,'assignment',$3,$4,$5,$6)`,
        [sub.user_id, sub.course_id, label, marks_obtained, max, (feedback||'').slice(0,500)]);
    }
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN: GIVE POINTS to any user (bonus points, not tied to an assignment)
// ═══════════════════════════════════════════════════════════════════════════════
async function adminPoints(req, res) {
  const admin = await requireStaff(req, res); if (!admin) return;

  await query(`CREATE TABLE IF NOT EXISTS user_marks (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    course_id INTEGER NOT NULL,
    exam_id INTEGER,
    type VARCHAR(30) NOT NULL DEFAULT 'assignment',
    label VARCHAR(255) DEFAULT 'Assignment',
    marks_obtained NUMERIC(8,2) NOT NULL DEFAULT 0,
    total_marks NUMERIC(8,2) NOT NULL DEFAULT 100,
    notes TEXT,
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  )`);
  try {
    await query(`ALTER TABLE user_marks DROP CONSTRAINT IF EXISTS user_marks_user_id_exam_id_type_key`);
    await query(`ALTER TABLE user_marks DROP CONSTRAINT IF EXISTS user_marks_user_id_course_id_label_type_key`);
  } catch(e) {}

  if (req.method === 'GET') {
    // Return all users for dropdown
    const users = await query(`SELECT id, username, email FROM users WHERE is_admin=FALSE ORDER BY username`);
    const courses = await query(`SELECT id, title FROM courses WHERE is_active=TRUE ORDER BY title`);
    return res.status(200).json({ success: true, users: users.rows, courses: courses.rows });
  }

  if (req.method === 'POST') {
    const { user_id, course_id, label, points, total_marks, notes } = req.body || {};
    if (!user_id || !course_id || points === undefined) return res.status(400).json({ success: false, error: 'user_id, course_id and points required' });
    const r = await query(
      `INSERT INTO user_marks (user_id, course_id, type, label, marks_obtained, total_marks, notes)
       VALUES ($1,$2,'points',$3,$4,$5,$6) RETURNING *`,
      [user_id, course_id, label||'Bonus Points', points, total_marks||points, notes||null]
    );
    return res.status(200).json({ success: true, mark: r.rows[0] });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}


// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN: RESOURCES (stored in course modules JSON field)
// ═══════════════════════════════════════════════════════════════════════════════
async function adminResources(req, res) {
  const admin = await requireStaff(req, res); if (!admin) return;

  if (req.method === 'POST') {
    const { course_id, title, url, icon, description } = req.body || {};
    if (!course_id || !title || !url) return res.status(400).json({ success: false, error: 'course_id, title and url required' });
    // Fetch current course modules
    const cr = await query(`SELECT modules FROM courses WHERE id=$1`, [course_id]);
    if (!cr.rows.length) return res.status(404).json({ success: false, error: 'Course not found' });
    let mods = {};
    try { mods = typeof cr.rows[0].modules === 'string' ? JSON.parse(cr.rows[0].modules) : (cr.rows[0].modules || {}); } catch(e) {}
    if (!Array.isArray(mods.resources)) mods.resources = [];
    const newResource = { id: Date.now().toString(), title, url, icon: icon||'🔗', description: description||'' };
    mods.resources.push(newResource);
    await query(`UPDATE courses SET modules=$1::jsonb WHERE id=$2`, [JSON.stringify(mods), course_id]);
    return res.status(200).json({ success: true, resource: newResource, resources: mods.resources });
  }

  if (req.method === 'DELETE') {
    const { course_id, resource_id } = req.body || {};
    if (!course_id || !resource_id) return res.status(400).json({ success: false, error: 'course_id and resource_id required' });
    const cr = await query(`SELECT modules FROM courses WHERE id=$1`, [course_id]);
    if (!cr.rows.length) return res.status(404).json({ success: false, error: 'Course not found' });
    let mods = {};
    try { mods = typeof cr.rows[0].modules === 'string' ? JSON.parse(cr.rows[0].modules) : (cr.rows[0].modules || {}); } catch(e) {}
    if (!Array.isArray(mods.resources)) mods.resources = [];
    mods.resources = mods.resources.filter(r => r.id !== resource_id);
    await query(`UPDATE courses SET modules=$1::jsonb WHERE id=$2`, [JSON.stringify(mods), course_id]);
    return res.status(200).json({ success: true, resources: mods.resources });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC: LEADERBOARD for a course (top users by total marks)
// ═══════════════════════════════════════════════════════════════════════════════
async function publicLeaderboard(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const { course_id } = req.query || {};
  if (!course_id) return res.status(400).json({ success: false, error: 'course_id required' });

  const r = await query(
    `SELECT u.id, u.username,
       SUM(um.marks_obtained) AS total_obtained,
       SUM(um.total_marks) AS total_possible,
       COUNT(um.id) AS entry_count
     FROM user_marks um
     JOIN users u ON u.id = um.user_id
     WHERE um.course_id=$1
     GROUP BY u.id, u.username
     ORDER BY total_obtained DESC
     LIMIT 100`,
    [course_id]
  );
  return res.status(200).json({ success: true, leaderboard: r.rows });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN: REORDER
// ═══════════════════════════════════════════════════════════════════════════════
async function adminReorder(req, res) {
  const admin = await requireStaff(req, res); if (!admin) return;
  if (req.method !== 'PUT') return res.status(405).json({ success: false, error: 'Method not allowed' });
  try {
    const { type, items } = req.body||{};
    const allowed = ['courses', 'mentors', 'testimonials'];
    if (!type || !allowed.includes(type)) return res.status(400).json({ success: false, error: 'Invalid type. Must be: courses, mentors, or testimonials' });
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ success: false, error: 'Items array required' });
    for (const item of items) {
      if (item.id === undefined || item.sort_order === undefined)
        return res.status(400).json({ success: false, error: 'Each item must have id and sort_order' });
    }
    await query('BEGIN');
    try {
      for (const item of items) {
        await query(`UPDATE ${type} SET sort_order=$1 WHERE id=$2`, [item.sort_order, item.id]);
      }
      await query('COMMIT');
    } catch (e) { await query('ROLLBACK'); throw e; }
    return res.status(200).json({ success: true, message: 'Order updated' });
  } catch (error) {
    console.error('Admin Reorder API Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ONE-TIME BOOT MIGRATION
// Runs DDL (ALTER TABLE / CREATE TABLE IF NOT EXISTS) exactly once per cold start.
// This prevents the same DDL from running on every request inside route handlers.
// ═══════════════════════════════════════════════════════════════════════════════
let _bootMigrationDone = false;
async function runBootMigration() {
  if (_bootMigrationDone) return;
  _bootMigrationDone = true;
  try {
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user'`);
    await query(`ALTER TABLE courses ALTER COLUMN title TYPE TEXT`);
    await query(`CREATE TABLE IF NOT EXISTS purchases (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
      sender_number VARCHAR(50),
      transaction_id VARCHAR(100),
      payment_method VARCHAR(50),
      status VARCHAR(50) DEFAULT 'pending',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )`);
    await query(`CREATE TABLE IF NOT EXISTS coupons (
      id SERIAL PRIMARY KEY, code VARCHAR(50) UNIQUE,
      discount_percent INT, new_price NUMERIC(10,2), course_id INTEGER,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    await query(`ALTER TABLE coupons ADD COLUMN IF NOT EXISTS new_price NUMERIC(10,2)`);
    await query(`ALTER TABLE coupons ADD COLUMN IF NOT EXISTS course_id INTEGER`);
    await query(`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(50)`);
    await query(`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS coupon_price NUMERIC(10,2)`);

    // ── Feature additions: categories, progress, certificates, reviews ──────────
    await query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS category VARCHAR(60) DEFAULT 'General'`);

    // Per-lesson completion tracking. lesson_index = flat index within course curriculum.
    await query(`CREATE TABLE IF NOT EXISTS lesson_progress (
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
      lesson_index INTEGER NOT NULL,
      lesson_title TEXT,
      completed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      PRIMARY KEY (user_id, course_id, lesson_index)
    )`);

    // Course reviews — one per user per course.
    await query(`CREATE TABLE IF NOT EXISTS course_reviews (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment TEXT DEFAULT '',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE (user_id, course_id)
    )`);

    // Issued certificates — cert_code is the public verification handle.
    await query(`CREATE TABLE IF NOT EXISTS certificates (
      id SERIAL PRIMARY KEY,
      cert_code VARCHAR(40) UNIQUE NOT NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
      recipient_name TEXT,
      course_title TEXT,
      issued_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE (user_id, course_id)
    )`);

    // ── Advanced exams: config columns on the existing exams table ──────────────
    await query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS pass_marks INTEGER`);
    await query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS max_attempts INTEGER DEFAULT 1`);
    await query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS shuffle_questions BOOLEAN DEFAULT FALSE`);
    await query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS shuffle_options BOOLEAN DEFAULT FALSE`);
    await query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS questions_per_attempt INTEGER`);
    await query(`ALTER TABLE exams ADD COLUMN IF NOT EXISTS show_answers BOOLEAN DEFAULT TRUE`);

    // One row per exam attempt. user_marks still holds the BEST score for the leaderboard.
    await query(`CREATE TABLE IF NOT EXISTS exam_attempts (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      exam_id INTEGER REFERENCES exams(id) ON DELETE CASCADE,
      course_id INTEGER,
      attempt_no INTEGER NOT NULL DEFAULT 1,
      score NUMERIC(8,2) NOT NULL DEFAULT 0,
      total NUMERIC(8,2) NOT NULL DEFAULT 0,
      passed BOOLEAN DEFAULT FALSE,
      answers JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )`);

    // Student assignment submissions — the missing learner-side submit flow.
    // assignment_id references modules.assignments_list[].id (a string).
    await query(`CREATE TABLE IF NOT EXISTS assignment_submissions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
      assignment_id VARCHAR(40) NOT NULL,
      assignment_title TEXT,
      submission_text TEXT DEFAULT '',
      submission_url TEXT DEFAULT '',
      file_data TEXT,
      file_name TEXT,
      status VARCHAR(20) NOT NULL DEFAULT 'submitted',
      marks_obtained NUMERIC(8,2),
      max_marks NUMERIC(8,2),
      feedback TEXT DEFAULT '',
      submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      graded_at TIMESTAMP WITH TIME ZONE,
      UNIQUE (user_id, assignment_id)
    )`);
  } catch (e) {
    // Non-fatal — log and continue; tables likely already exist
    console.warn('Boot migration warning:', e.message);
    _bootMigrationDone = false; // allow retry on next request if it failed
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// LEARNER FEATURES: progress · reviews · certificates
// ═══════════════════════════════════════════════════════════════════════════════

// Count total lectures in a course's modules JSON (authoritative for completion %).
function countCourseLessons(modules) {
  let mods = modules;
  if (typeof mods === 'string') { try { mods = JSON.parse(mods); } catch { mods = {}; } }
  if (!mods || typeof mods !== 'object') return 0;
  const curriculum = Array.isArray(mods.curriculum) ? mods.curriculum : [];
  return curriculum.reduce((sum, m) => sum + (Array.isArray(m.lectures) ? m.lectures.length : 0), 0);
}

// ── USER: GET/POST/DELETE /api/user/progress ──────────────────────────────────
// GET  ?course_id=  → { completed:[indices], total, percent }
// POST { course_id, lesson_index, lesson_title } → mark a lesson complete
// DELETE { course_id, lesson_index } → mark incomplete
async function userProgress(req, res) {
  const user = await requireUser(req, res); if (!user) return;

  if (req.method === 'GET') {
    const courseId = parseInt((req.query?.course_id) || (req.url.split('course_id=')[1] || '').split('&')[0]);
    if (!courseId) return res.status(400).json({ success: false, error: 'course_id required' });
    const rows = await query(
      'SELECT lesson_index FROM lesson_progress WHERE user_id=$1 AND course_id=$2 ORDER BY lesson_index',
      [user.id, courseId]
    );
    const courseR = await query('SELECT modules FROM courses WHERE id=$1', [courseId]);
    const total = courseR.rows.length ? countCourseLessons(courseR.rows[0].modules) : 0;
    const completed = rows.rows.map(r => r.lesson_index);
    const percent = total > 0 ? Math.round((completed.length / total) * 100) : 0;
    return res.status(200).json({ success: true, completed, total, percent });
  }

  if (req.method === 'POST') {
    const { course_id, lesson_index, lesson_title } = req.body || {};
    if (!course_id || lesson_index == null) return res.status(400).json({ success: false, error: 'course_id and lesson_index required' });
    if (!(await isEnrolled(user.id, course_id))) return res.status(403).json({ success: false, error: 'Not enrolled in this course' });
    await query(
      `INSERT INTO lesson_progress (user_id, course_id, lesson_index, lesson_title)
       VALUES ($1,$2,$3,$4) ON CONFLICT (user_id, course_id, lesson_index) DO NOTHING`,
      [user.id, course_id, lesson_index, (lesson_title || '').slice(0, 300)]
    );
    return res.status(200).json({ success: true });
  }

  if (req.method === 'DELETE') {
    const { course_id, lesson_index } = req.body || {};
    if (!course_id || lesson_index == null) return res.status(400).json({ success: false, error: 'course_id and lesson_index required' });
    await query('DELETE FROM lesson_progress WHERE user_id=$1 AND course_id=$2 AND lesson_index=$3', [user.id, course_id, lesson_index]);
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// ── PUBLIC: GET /api/_public/reviews?course_id= ───────────────────────────────
async function publicReviews(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const courseId = parseInt((req.query?.course_id) || (req.url.split('course_id=')[1] || '').split('&')[0]);
  if (!courseId) return res.status(400).json({ success: false, error: 'course_id required' });
  const r = await query(`
    SELECT cr.id, cr.rating, cr.comment, cr.created_at, cr.updated_at, u.username
    FROM course_reviews cr JOIN users u ON u.id = cr.user_id
    WHERE cr.course_id=$1 ORDER BY cr.updated_at DESC
  `, [courseId]);
  const agg = await query(
    'SELECT COALESCE(ROUND(AVG(rating)::numeric,1),0) AS avg_rating, COUNT(*)::int AS review_count FROM course_reviews WHERE course_id=$1',
    [courseId]
  );
  return res.status(200).json({
    success: true,
    reviews: r.rows,
    avg_rating: parseFloat(agg.rows[0].avg_rating),
    review_count: agg.rows[0].review_count
  });
}

// ── USER: GET/POST/DELETE /api/user/reviews ───────────────────────────────────
// GET  ?course_id=  → this user's own review (or null)
// POST { course_id, rating, comment } → create/update own review (must be enrolled)
async function userReviews(req, res) {
  const user = await requireUser(req, res); if (!user) return;

  if (req.method === 'GET') {
    const courseId = parseInt((req.query?.course_id) || (req.url.split('course_id=')[1] || '').split('&')[0]);
    if (!courseId) return res.status(400).json({ success: false, error: 'course_id required' });
    const r = await query('SELECT id, rating, comment, created_at, updated_at FROM course_reviews WHERE user_id=$1 AND course_id=$2', [user.id, courseId]);
    return res.status(200).json({ success: true, review: r.rows[0] || null });
  }

  if (req.method === 'POST') {
    const { course_id, rating, comment } = req.body || {};
    const rt = parseInt(rating);
    if (!course_id || !rt || rt < 1 || rt > 5) return res.status(400).json({ success: false, error: 'course_id and rating (1-5) required' });
    if (!(await isEnrolled(user.id, course_id))) return res.status(403).json({ success: false, error: 'Only enrolled learners can review this course' });
    const r = await query(`
      INSERT INTO course_reviews (user_id, course_id, rating, comment, created_at, updated_at)
      VALUES ($1,$2,$3,$4,NOW(),NOW())
      ON CONFLICT (user_id, course_id) DO UPDATE
        SET rating=EXCLUDED.rating, comment=EXCLUDED.comment, updated_at=NOW()
      RETURNING id, rating, comment, created_at, updated_at
    `, [user.id, course_id, rt, (comment || '').slice(0, 2000)]);
    return res.status(200).json({ success: true, review: r.rows[0] });
  }

  if (req.method === 'DELETE') {
    const { course_id } = req.body || {};
    if (!course_id) return res.status(400).json({ success: false, error: 'course_id required' });
    await query('DELETE FROM course_reviews WHERE user_id=$1 AND course_id=$2', [user.id, course_id]);
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// ── USER: GET/POST /api/user/certificates ─────────────────────────────────────
// GET  → all certificates owned by the user
// POST { course_id } → issue a certificate IF the user has completed 100% of lessons
async function userCertificates(req, res) {
  const user = await requireUser(req, res); if (!user) return;

  if (req.method === 'GET') {
    const r = await query(`
      SELECT ce.cert_code, ce.course_id, ce.recipient_name, ce.course_title, ce.issued_at
      FROM certificates ce WHERE ce.user_id=$1 ORDER BY ce.issued_at DESC
    `, [user.id]);
    return res.status(200).json({ success: true, certificates: r.rows });
  }

  if (req.method === 'POST') {
    const { course_id } = req.body || {};
    if (!course_id) return res.status(400).json({ success: false, error: 'course_id required' });
    if (!(await isEnrolled(user.id, course_id))) return res.status(403).json({ success: false, error: 'Not enrolled in this course' });

    const courseR = await query('SELECT id, title, modules FROM courses WHERE id=$1', [course_id]);
    if (!courseR.rows.length) return res.status(404).json({ success: false, error: 'Course not found' });
    const course = courseR.rows[0];
    const total = countCourseLessons(course.modules);
    if (total === 0) return res.status(400).json({ success: false, error: 'This course has no lessons to complete yet' });

    const doneR = await query('SELECT COUNT(*)::int AS n FROM lesson_progress WHERE user_id=$1 AND course_id=$2', [user.id, course_id]);
    if (doneR.rows[0].n < total) {
      return res.status(403).json({ success: false, error: `Complete all lessons first (${doneR.rows[0].n}/${total})` });
    }

    // Return existing certificate if already issued (idempotent).
    const existing = await query('SELECT cert_code, course_title, recipient_name, issued_at FROM certificates WHERE user_id=$1 AND course_id=$2', [user.id, course_id]);
    if (existing.rows.length) return res.status(200).json({ success: true, certificate: existing.rows[0], alreadyIssued: true });

    const certCode = 'DF-' + crypto.randomBytes(5).toString('hex').toUpperCase();
    const r = await query(`
      INSERT INTO certificates (cert_code, user_id, course_id, recipient_name, course_title)
      VALUES ($1,$2,$3,$4,$5) RETURNING cert_code, course_title, recipient_name, issued_at
    `, [certCode, user.id, course_id, user.username, course.title]);
    return res.status(201).json({ success: true, certificate: r.rows[0] });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// ── PUBLIC: GET /api/_public/verify-certificate?code= ─────────────────────────
async function verifyCertificate(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const code = ((req.query?.code) || (req.url.split('code=')[1] || '').split('&')[0] || '').toUpperCase().trim();
  if (!code) return res.status(400).json({ success: false, error: 'code required' });
  const r = await query(
    'SELECT cert_code, recipient_name, course_title, issued_at FROM certificates WHERE cert_code=$1',
    [code]
  );
  if (!r.rows.length) return res.status(404).json({ success: false, valid: false, error: 'Certificate not found' });
  return res.status(200).json({ success: true, valid: true, certificate: r.rows[0] });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN DISPATCHER
// ═══════════════════════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Run one-time DDL migrations on first request (non-blocking for subsequent requests)
  await runBootMigration();

  const path = req.url.split('?')[0].replace(/\/$/, '');

  try {
    // Public
    if (path.endsWith('/_public/courses')       || path.endsWith('/public/courses'))       return await publicCourses(req, res);
    if (path.endsWith('/_public/verify-coupon') || path.endsWith('/public/verify-coupon')) return await verifyCoupon(req, res);
    if (path.endsWith('/_public/mentors')       || path.endsWith('/public/mentors'))       return await publicMentors(req, res);
    if (path.endsWith('/_public/testimonials')  || path.endsWith('/public/testimonials'))  return await publicTestimonials(req, res);
    if (path.endsWith('/_public/reviews')       || path.endsWith('/public/reviews'))       return await publicReviews(req, res);
    if (path.endsWith('/_public/verify-certificate') || path.endsWith('/public/verify-certificate')) return await verifyCertificate(req, res);

    // Learner features (require login)
    if (path.endsWith('/user/progress'))       return await userProgress(req, res);
    if (path.endsWith('/user/reviews'))        return await userReviews(req, res);
    if (path.endsWith('/user/certificates'))   return await userCertificates(req, res);
    if (path.endsWith('/user/submissions'))    return await userSubmissions(req, res);
    if (path.endsWith('/admin/submissions'))   return await adminSubmissions(req, res);

    // IMPORTANT: specific routes checked before generic /purchases to avoid endsWith overlap
    if (path.endsWith('/admin/purchases'))     return await adminPurchases(req, res);
    if (path.endsWith('/admin/coupons'))       return await adminCoupons(req, res);
    if (path.endsWith('/user/purchases'))      return await userPurchases(req, res);
    if (path.endsWith('/purchases'))           return await createPurchase(req, res);

    // Auth
    if (path.endsWith('/auth/register'))       return await authRegister(req, res);
    if (path.endsWith('/auth/login'))          return await authLogin(req, res);
    if (path.endsWith('/auth/logout'))         return await authLogout(req, res);
    if (path.endsWith('/auth/verify'))         return await authVerify(req, res);
    if (path.endsWith('/auth/forgot-password')) return await authForgotPassword(req, res);
    if (path.endsWith('/auth/reset-password')) return await authResetPassword(req, res);
    if (path.endsWith('/auth/verify-email'))   return await authVerifyEmail(req, res);

    // Admin (remaining)
    if (path.endsWith('/admin/init'))          return await adminInit(req, res);
    if (path.endsWith('/admin/courses'))       return await adminCourses(req, res);
    if (path.endsWith('/admin/users'))         return await adminUsers(req, res);
    if (path.endsWith('/admin/set-role'))       return await adminSetRole(req, res);
    if (path.endsWith('/admin/grant-access'))  return await adminGrantAccess(req, res);
    if (path.endsWith('/user/update-profile'))  return await userUpdateProfile(req, res);
    if (path.endsWith('/admin/update-profile')) return await adminUpdateProfile(req, res);
    if (path.endsWith('/admin/mentors'))       return await adminMentors(req, res);
    if (path.endsWith('/admin/testimonials'))  return await adminTestimonials(req, res);
    if (path.endsWith('/admin/reorder'))       return await adminReorder(req, res);
    if (path.endsWith('/admin/exams'))         return await adminExams(req, res);
    if (path.endsWith('/admin/marks'))         return await adminMarks(req, res);
    if (path.endsWith('/user/marks'))          return await userMarks(req, res);
    if (path.endsWith('/_public/leaderboard') || path.endsWith('/public/leaderboard')) return await publicLeaderboard(req, res);
    if (path.endsWith('/_public/exam')        || path.endsWith('/public/exam'))        return await publicExam(req, res);
    if (path.endsWith('/exam/submit'))         return await submitExam(req, res);
    if (path.endsWith('/admin/resources'))       return await adminResources(req, res);
    if (path.endsWith('/admin/assignments-crud')) return await adminAssignmentsCrud(req, res);
    if (path.endsWith('/admin/points'))           return await adminPoints(req, res);
    if (path.endsWith('/admin/backup/export'))    return await adminBackupExport(req, res);
    if (path.endsWith('/admin/backup/import'))    return await adminBackupImport(req, res);

    return res.status(404).json({ success: false, error: `No route: ${path}` });
  } catch (err) {
    console.error('API Error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// ── ADMIN: GET /api/admin/backup/export ───────────────────────────────────────
// Returns full user snapshot: credentials, enrollments, marks
async function adminBackupExport(req, res) {
  const admin = await requireAdmin(req, res); if (!admin) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  // Users with their enrolled courses
  const usersR = await query(`
    SELECT u.id, u.username, u.email, u.password_hash, u.verified,
           u.is_admin, u.role, u.created_at,
           COALESCE(json_agg(
             json_build_object('course_id', uc.course_id, 'title', c.title, 'granted_at', uc.granted_at)
           ) FILTER (WHERE uc.course_id IS NOT NULL), '[]') AS courses
    FROM users u
    LEFT JOIN user_courses uc ON uc.user_id = u.id
    LEFT JOIN courses c ON c.id = uc.course_id
    GROUP BY u.id ORDER BY u.created_at ASC
  `);

  // All marks
  const marksR = await query(`
    SELECT um.user_id, u.username, um.course_id, c.title AS course_title,
           um.label, um.marks_obtained, um.total_marks, um.type, um.notes, um.submitted_at
    FROM user_marks um
    LEFT JOIN users u ON u.id = um.user_id
    LEFT JOIN courses c ON c.id = um.course_id
    ORDER BY um.user_id, um.submitted_at
  `);

  // Group marks by user_id
  const marksByUser = {};
  for (const m of marksR.rows) {
    if (!marksByUser[m.user_id]) marksByUser[m.user_id] = [];
    marksByUser[m.user_id].push(m);
  }

  return res.status(200).json({
    success: true,
    exported_at: new Date().toISOString(),
    users: usersR.rows,
    marks_by_user: marksByUser
  });
}

// ── ADMIN: POST /api/admin/backup/import ──────────────────────────────────────
// Restores users + enrollments from a backup payload (upserts, never deletes)
async function adminBackupImport(req, res) {
  const admin = await requireAdmin(req, res); if (!admin) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { users } = req.body || {};
  if (!Array.isArray(users) || !users.length)
    return res.status(400).json({ success: false, error: 'users array required' });

  let restored = 0, skipped = 0, coursesLinked = 0;

  for (const u of users) {
    if (!u.email || !u.username || !u.password_hash) { skipped++; continue; }
    try {
      // Upsert user — on conflict by email, restore password_hash + username if not admin
      const upsert = await query(`
        INSERT INTO users (username, email, password_hash, verified, is_admin, role, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (email) DO UPDATE
          SET password_hash = EXCLUDED.password_hash,
              username      = EXCLUDED.username,
              verified      = EXCLUDED.verified,
              role          = EXCLUDED.role
        RETURNING id
      `, [
        u.username, u.email.toLowerCase(), u.password_hash,
        u.verified ?? false, u.is_admin ?? false, u.role || 'user',
        u.created_at || new Date().toISOString()
      ]);

      const userId = upsert.rows[0].id;
      restored++;

      // Re-link course enrollments
      if (Array.isArray(u.courses)) {
        for (const c of u.courses) {
          if (!c.course_id) continue;
          // Only link if course still exists
          const cExists = await query('SELECT id FROM courses WHERE id=$1', [c.course_id]);
          if (!cExists.rows.length) continue;
          await query(`
            INSERT INTO user_courses (user_id, course_id, granted_by, granted_at)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (user_id, course_id) DO NOTHING
          `, [userId, c.course_id, admin.id, c.granted_at || new Date().toISOString()]);
          coursesLinked++;
        }
      }
    } catch (e) {
      console.error('Import row error:', e.message);
      skipped++;
    }
  }

  return res.status(200).json({
    success: true,
    message: `Restored ${restored} user(s), linked ${coursesLinked} enrollment(s). Skipped ${skipped}.`,
    restored, coursesLinked, skipped
  });
}

export const config = {
  api: { bodyParser: { sizeLimit: '10mb' } }
};