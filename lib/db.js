import { Pool } from 'pg';

/**
 * Database connection pool for PostgreSQL (compatible with Vercel Postgres, Neon, and standard PostgreSQL)
 * Environment variables required:
 * - POSTGRES_URL: Connection string for PostgreSQL
 * - POSTGRES_PRISMA_URL: Alternative connection string
 * - POSTGRES_URL_NON_POOLING: Non-pooling connection string
 * - POSTGRES_USER: Database username
 * - POSTGRES_HOST: Database host
 * - POSTGRES_PASSWORD: Database password
 * - POSTGRES_DATABASE: Database name
 * 
 * For Neon: Use the connection string provided by Neon dashboard
 * For Vercel Postgres: Use the connection string provided by Vercel
 */

let pool;

/**
 * Initialize or get the database connection pool
 * @returns {Promise<import('pg').Pool>} Database pool
 */
export async function getPool() {
  if (!pool) {
    // Check for required environment variables
    if (!process.env.POSTGRES_URL) {
      console.warn('POSTGRES_URL environment variable is not set. Using local development fallback.');
      // For local development, you can set a mock or use a local connection
      // In production on Vercel/Neon, this will be automatically set
    }
    
    // Determine which connection string to use
    let connectionString = process.env.POSTGRES_URL;
    
    // If no POSTGRES_URL, try to construct from individual components
    if (!connectionString) {
      const user = process.env.POSTGRES_USER || 'default';
      const password = process.env.POSTGRES_PASSWORD || '';
      const host = process.env.POSTGRES_HOST || 'localhost';
      const port = process.env.POSTGRES_PORT || '5432';
      const database = process.env.POSTGRES_DATABASE || 'decentraforce_local';
      
      connectionString = `postgresql://${user}:${password}@${host}:${port}/${database}`;
    }
    
    // Parse the connection string to extract components for Pool config
    const url = new URL(connectionString);
    
    pool = new Pool({
      user: url.username || process.env.POSTGRES_USER || 'default',
      password: url.password || process.env.POSTGRES_PASSWORD || '',
      host: url.hostname || process.env.POSTGRES_HOST || 'localhost',
      port: url.port || process.env.POSTGRES_PORT || '5432',
      database: url.pathname.slice(1) || process.env.POSTGRES_DATABASE || 'decentraforce_local',
      ssl: process.env.NODE_ENV === 'production' ? {
        rejectUnauthorized: false
      } : false,
      // Connection pool settings
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
    
    // Test the connection
    try {
      const client = await pool.connect();
      console.log('Database connection established successfully');
      client.release();
    } catch (error) {
      console.error('Failed to connect to the database:', error.message);
      throw error;
    }
  }
  
  return pool;
}

/**
 * Execute a SQL query with parameters
 * @param {string} text SQL query text
 * @param {any[]} params Query parameters
 * @returns {Promise<import('pg').QueryResult>} Query result
 */
export async function query(text, params) {
  const pool = await getPool();
  try {
    return await pool.query(text, params);
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}

/**
 * Initialize the database schema (create tables if they don't exist)
 * This should be run once when setting up the application
 *//**
 * Initialize the database schema (create tables if they don't exist)
 * This should be run once when setting up the application
 */
export async function initDatabase() {
  try {
    const pool = await getPool();
    
    // 1. Create users table with ALL the columns your API expects (including is_admin)
    // REMOVED: DROP TABLE commands
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        verified BOOLEAN DEFAULT FALSE,
        verification_token VARCHAR(100),
        verification_expires TIMESTAMP WITH TIME ZONE,
        session_token VARCHAR(100),
        session_expires TIMESTAMP WITH TIME ZONE,
        is_admin BOOLEAN DEFAULT FALSE
      );
    `);
    
    // 2. Create password_reset_tokens table (required for forgot password)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(64) UNIQUE NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3. Create purchases table (required for course purchases)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS purchases (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
        sender_number VARCHAR(50) NOT NULL,
        transaction_id VARCHAR(100) NOT NULL,
        payment_method VARCHAR(50) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log('Database schema initialized successfully with correct columns');
  } catch (error) {
    console.error('Error initializing database schema:', error);
    throw error;
  }
}

/**
 * Close the database connection pool
 */
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('Database connection pool closed');
  }
}

/**
 * Run once to add admin-related columns and tables
 * (safe to run multiple times — uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
 */
/**
 * Run once to add admin-related columns and tables
 * (safe to run multiple times — uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
 */
export async function initAdminSchema() {
  const pool = await getPool();

  // Add is_admin column to users if missing
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;`);

await pool.query(`
  CREATE TABLE IF NOT EXISTS purchases (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
    sender_number VARCHAR(50),
    transaction_id VARCHAR(100),
    payment_method VARCHAR(50),
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );
`);


  // Courses table (Updated to include all current columns in the initial creation)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS courses (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      thumbnail_url TEXT DEFAULT '',
      video_url TEXT DEFAULT '',
      price NUMERIC DEFAULT 0,
      discount_price NUMERIC DEFAULT NULL,
      whatsapp VARCHAR(255),
      status VARCHAR(50) DEFAULT 'upcoming',
      sequence_order INT DEFAULT 9999,
      modules JSONB DEFAULT '[]',
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ALTER statements to safely add missing columns to an existing table
  await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS price NUMERIC DEFAULT 0;`);
  await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS discount_price NUMERIC DEFAULT NULL;`);
  await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS whatsapp VARCHAR(255);`);
  await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'upcoming';`);
  await pool.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS sequence_order INT DEFAULT 9999;`);

  // User → course access table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_courses (
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
      granted_by INTEGER REFERENCES users(id),
      granted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, course_id)
    );
  `);

  console.log('Admin schema ready.');
}