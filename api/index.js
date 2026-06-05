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

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════

// ── PUBLIC: GET /api/_public/courses ─────────────────────────────────────────
async function publicCourses(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const r = await query(`
    SELECT id, title, description,
      CASE WHEN length(thumbnail_url)>2000000 THEN '' ELSE thumbnail_url END AS thumbnail_url,
      modules, created_at, price, discount_price, whatsapp, status, sequence_order
    FROM courses WHERE is_active=TRUE ORDER BY COALESCE(sequence_order,9999), created_at DESC
  `);
  return res.status(200).json({ success: true, courses: r.rows });
}

// ── PUBLIC: POST /api/_public/verify-coupon ───────────────────────────────────
async function verifyCoupon(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { code } = req.body || {};
  const r = await query('SELECT discount_percent FROM coupons WHERE code=$1', [(code||'').toUpperCase().trim()]);
  if (r.rows.length) return res.status(200).json({ success: true, discount: r.rows[0].discount_percent });
  return res.status(400).json({ success: false, error: 'Invalid or expired coupon' });
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
  const { course_id, sender_number, transaction_id, payment_method } = req.body || {};
  
  if (!course_id) return res.status(400).json({ success: false, error: 'Course ID required' });
  if (!sender_number) return res.status(400).json({ success: false, error: 'Sender number required' });
  if (!transaction_id) return res.status(400).json({ success: false, error: 'Transaction ID required' });
  
  // Verify course exists
  const courseResult = await query('SELECT id FROM courses WHERE id=$1', [course_id]);
  if (!courseResult.rows.length) return res.status(404).json({ success: false, error: 'Course not found' });


  // Insert purchase with pending status
  const result = await query(
    `INSERT INTO purchases (user_id, course_id, sender_number, transaction_id, payment_method, status)
     VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING *`,
    [user.id, course_id, sender_number, transaction_id, payment_method || 'unknown']
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
        c.price,c.discount_price,c.whatsapp,c.status,c.sequence_order,
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
    const { title,description,thumbnail_url,video_url,price,discount_price,whatsapp,modules,is_active,status,sequence_order } = req.body||{};
    if (!title) return res.status(400).json({ success: false, error: 'Title required' });
    if (price==null) return res.status(400).json({ success: false, error: 'Price required' });
    if (!whatsapp) return res.status(400).json({ success: false, error: 'WhatsApp link required' });
    const r = await query(
      `INSERT INTO courses (title,description,thumbnail_url,video_url,price,discount_price,whatsapp,modules,is_active,status,sequence_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11) RETURNING *`,
      [title,description||'',thumbnail_url||'',video_url||'',price,discount_price||null,whatsapp,modules||'{}',is_active!==false,status||'upcoming',sequence_order??9999]
    );
    return res.status(201).json({ success: true, course: r.rows[0] });
  }
  if (req.method === 'PUT') {
    const { id,title,description,thumbnail_url,video_url,price,discount_price,whatsapp,modules,is_active,status,sequence_order } = req.body||{};
    if (!id) return res.status(400).json({ success: false, error: 'ID required' });
    const r = await query(
      `UPDATE courses SET title=$1,description=$2,thumbnail_url=$3,video_url=$4,price=$5,discount_price=$6,whatsapp=$7,
       modules=$8::jsonb,is_active=$9,status=$10,sequence_order=$11 WHERE id=$12 RETURNING *`,
      [title,description,thumbnail_url,video_url,price,discount_price||null,whatsapp,modules,is_active,status||'upcoming',sequence_order??9999,id]
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
    const { course_id, title, type, link_url, total_marks, duration_minutes, questions } = req.body || {};
    if (!course_id || !title) return res.status(400).json({ success: false, error: 'course_id and title required' });
    const r = await query(
      `INSERT INTO exams (course_id, title, type, link_url, total_marks, duration_minutes, questions)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [course_id, title, type||'mcq', link_url||null, total_marks||100, duration_minutes||60, JSON.stringify(questions||[])]
    );
    return res.status(200).json({ success: true, exam: r.rows[0] });
  }

  if (req.method === 'PUT') {
    const { id, title, type, link_url, total_marks, duration_minutes, questions, is_active } = req.body || {};
    if (!id) return res.status(400).json({ success: false, error: 'id required' });
    const r = await query(
      `UPDATE exams SET title=$1, type=$2, link_url=$3, total_marks=$4, duration_minutes=$5, questions=$6, is_active=$7
       WHERE id=$8 RETURNING *`,
      [title, type||'mcq', link_url||null, total_marks||100, duration_minutes||60, JSON.stringify(questions||[]), is_active!==false, id]
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
async function publicExam(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const { course_id } = req.query || {};
  if (!course_id) return res.status(400).json({ success: false, error: 'course_id required' });

  const r = await query(
    `SELECT id, course_id, title, type, link_url, total_marks, duration_minutes,
       CASE WHEN type='mcq' THEN
         (SELECT jsonb_agg(jsonb_build_object(
           'id', q->>'id', 'question', q->>'question',
           'options', q->'options', 'marks', q->'marks'
         )) FROM jsonb_array_elements(questions) q)
       ELSE '[]'::jsonb END AS questions
     FROM exams WHERE course_id=$1 AND is_active=TRUE ORDER BY created_at DESC LIMIT 1`,
    [course_id]
  );
  if (!r.rows.length) return res.status(200).json({ success: true, exam: null });
  return res.status(200).json({ success: true, exam: r.rows[0] });
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

  const examResult = await query(`SELECT * FROM exams WHERE id=$1`, [exam_id]);
  if (!examResult.rows.length) return res.status(404).json({ success: false, error: 'Exam not found' });
  const exam = examResult.rows[0];
  const questions = Array.isArray(exam.questions) ? exam.questions : JSON.parse(exam.questions || '[]');

  let score = 0;
  const feedback = [];
  questions.forEach(q => {
    const userAnswer = answers[q.id];
    const correct = userAnswer === q.correct_answer;
    if (correct) score += (q.marks || 1);
    feedback.push({ id: q.id, correct, correct_answer: q.correct_answer, user_answer: userAnswer });
  });

  // Update existing exam submission or insert new one
  const existing = await query(
    `SELECT id FROM user_marks WHERE user_id=$1 AND exam_id=$2 AND type='exam'`,
    [user.id, exam_id]
  );
  if (existing.rows.length > 0) {
    await query(
      `UPDATE user_marks SET marks_obtained=$1, submitted_at=NOW() WHERE id=$2`,
      [score, existing.rows[0].id]
    );
  } else {
    await query(
      `INSERT INTO user_marks (user_id, course_id, exam_id, type, label, marks_obtained, total_marks)
       VALUES ($1,$2,$3,'exam',$4,$5,$6)`,
      [user.id, exam.course_id, exam_id, exam.title, score, exam.total_marks]
    );
  }

  return res.status(200).json({ success: true, score, total: exam.total_marks, feedback });
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
      discount_percent INT, created_at TIMESTAMP DEFAULT NOW()
    )`);
  } catch (e) {
    // Non-fatal — log and continue; tables likely already exist
    console.warn('Boot migration warning:', e.message);
    _bootMigrationDone = false; // allow retry on next request if it failed
  }
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

    // IMPORTANT: specific routes checked before generic /purchases to avoid endsWith overlap
    if (path.endsWith('/admin/purchases'))     return await adminPurchases(req, res);
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