/**
 * Run this script ONCE to set up admin account and new tables.
 * Usage: node scripts/setup-admin.js
 *
 * This will:
 *   1. Add is_admin column to users table
 *   2. Create courses table
 *   3. Create user_courses table
 *   4. Upsert the admin user (asikrac@gmail.com / asikasik)
 */

import { getPool } from '../lib/db.js';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function setupAdmin() {
  const pool = await getPool();

  // 1. Add is_admin column if it doesn't exist
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;
  `);
  console.log('✅ is_admin column ready');

  // 2. Create courses table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS courses (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT DEFAULT '',
      thumbnail_url TEXT DEFAULT '',
      video_url TEXT DEFAULT '',
      modules JSONB DEFAULT '[]',
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log('✅ courses table ready');

  // 3. Create user_courses table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_courses (
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
      granted_by INTEGER REFERENCES users(id),
      granted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, course_id)
    );
  `);
  console.log('✅ user_courses table ready');

  // 4. Upsert admin user
  const ADMIN_EMAIL = 'asikrac@gmail.com';
  const ADMIN_PASSWORD = 'asikasik';
  const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 12);

  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [ADMIN_EMAIL]);

  if (existing.rows.length > 0) {
    // Update existing user to be admin with correct password
    await pool.query(
      `UPDATE users SET password_hash = $1, is_admin = TRUE, verified = TRUE WHERE email = $2`,
      [hashedPassword, ADMIN_EMAIL]
    );
    console.log('✅ Admin user updated');
  } else {
    // Create admin user
    await pool.query(
      `INSERT INTO users (username, email, password_hash, is_admin, verified)
       VALUES ($1, $2, $3, TRUE, TRUE)`,
      ['Admin', ADMIN_EMAIL, hashedPassword]
    );
    console.log('✅ Admin user created');
  }

  // 5. Add sample courses if table is empty
  const courseCount = await pool.query('SELECT COUNT(*) FROM courses');
  if (parseInt(courseCount.rows[0].count) === 0) {
    console.log('Adding sample courses...');
    
    const sampleCourses = [
      {
        title: 'Fullstack Blockchain Development',
        description: 'Master Ethereum, Solidity, Web3.js, and build real DApps from scratch.',
        price: 5000,
        whatsapp: 'https://chat.whatsapp.com/sample1',
        status: 'active',
        thumbnail_url: 'https://images.unsplash.com/photo-1620336655055-bd87c5d1d73f?w=400&h=225&fit=crop',
        video_url: 'https://youtube.com/watch?v=sample1'
      },
      {
        title: 'ব্লকচেইন ডেভেলপমেন্ট বাংলায়',
        description: 'বাংলা ভাষায় সম্পূর্ণ ব্লকচেইন ডেভেলপমেন্ট শিখুন। ইথেরিয়াম, সলিডিটি, ওয়েব৩.জেস।',
        price: 4000,
        whatsapp: 'https://chat.whatsapp.com/sample2',
        status: 'active',
        thumbnail_url: 'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=400&h=225&fit=crop',
        video_url: 'https://youtube.com/watch?v=sample2'
      },
      {
        title: 'DeFi & Smart Contracts Mastery',
        description: 'Learn to build and audit DeFi protocols, yield farming, liquidity pools, and more.',
        price: 6000,
        whatsapp: 'https://chat.whatsapp.com/sample3',
        status: 'upcoming',
        thumbnail_url: 'https://images.unsplash.com/photo-1621761191319-c6fb62004040?w=400&h=225&fit=crop',
        video_url: 'https://youtube.com/watch?v=sample3'
      },
      {
        title: 'NFT & Metaverse Development',
        description: 'Create NFT marketplaces, metaverse assets, and Web3 gaming experiences.',
        price: 5500,
        whatsapp: 'https://chat.whatsapp.com/sample4',
        status: 'active',
        thumbnail_url: 'https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=400&h=225&fit=crop',
        video_url: 'https://youtube.com/watch?v=sample4'
      },
      {
        title: 'ওয়েব৩ ও ক্রিপ্টোকারেন্সি বেসিক',
        description: 'ক্রিপ্টোকারেন্সি এবং ওয়েব৩ প্রযুক্তির বেসিক থেকে এডভান্সড সবকিছু বাংলায়।',
        price: 3000,
        whatsapp: 'https://chat.whatsapp.com/sample5',
        status: 'active',
        thumbnail_url: 'https://images.unsplash.com/photo-1518546305927-5a555bb7020d?w=400&h=225&fit=crop',
        video_url: 'https://youtube.com/watch?v=sample5'
      }
    ];

    for (const course of sampleCourses) {
      await pool.query(
        `INSERT INTO courses (title, description, price, whatsapp, status, thumbnail_url, video_url, modules, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          course.title,
          course.description,
          course.price,
          course.whatsapp,
          course.status,
          course.thumbnail_url,
          course.video_url,
          JSON.stringify([]), // empty modules
          true
        ]
      );
    }
    console.log(`✅ ${sampleCourses.length} sample courses added`);
  } else {
    console.log('✅ Courses table already has data, skipping sample courses');
  }

  console.log('\n🎉 Admin setup complete!');
  console.log(`   Email:    ${ADMIN_EMAIL}`);
  console.log(`   Password: ${ADMIN_PASSWORD}`);
  console.log('\nYou can now log in at /login.html and access the admin panel at /admin.html');

  process.exit(0);
}

setupAdmin().catch(err => {
  console.error('Setup failed:', err);
  process.exit(1);
});
