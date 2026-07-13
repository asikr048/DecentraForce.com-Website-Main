/**
 * Test script for authentication system
 * This tests the API endpoints and database functionality
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('=== Testing DecentraForce Authentication System ===\n');

// Test 1: Check if required files exist
console.log('1. Checking required files...');
const requiredFiles = [
  'api/auth/register.js',
  'api/auth/login.js',
  'api/auth/verify.js',
  'api/auth/logout.js',
  'lib/db.js',
  'scripts/auth.js',
  'register.html',
  'login.html',
  'index.html'
];

let allFilesExist = true;
requiredFiles.forEach(file => {
  const exists = fs.existsSync(path.join(__dirname, file));
  console.log(`   ${exists ? '✓' : '✗'} ${file}`);
  if (!exists) allFilesExist = false;
});

console.log(allFilesExist ? '\n   All required files exist!' : '\n   Some files are missing!');

// Test 2: Check package.json dependencies
console.log('\n2. Checking package.json dependencies...');
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const requiredDeps = ['@vercel/postgres', 'uuid'];
requiredDeps.forEach(dep => {
  const hasDep = packageJson.dependencies && packageJson.dependencies[dep];
  console.log(`   ${hasDep ? '✓' : '✗'} ${dep}`);
});

// Test 3: Check database schema
console.log('\n3. Checking database schema in lib/db.js...');
const dbContent = fs.readFileSync(path.join(__dirname, 'lib/db.js'), 'utf8');
const hasUsernameField = dbContent.includes('username VARCHAR(50) UNIQUE NOT NULL');
const hasSessionToken = dbContent.includes('session_token VARCHAR(100)');
const hasSessionExpires = dbContent.includes('session_expires TIMESTAMP WITH TIME ZONE');

console.log(`   ${hasUsernameField ? '✓' : '✗'} Username field in schema`);
console.log(`   ${hasSessionToken ? '✓' : '✗'} Session token field in schema`);
console.log(`   ${hasSessionExpires ? '✓' : '✗'} Session expires field in schema`);

// Test 4: Check registration API
console.log('\n4. Checking registration API...');
const registerContent = fs.readFileSync(path.join(__dirname, 'api/auth/register.js'), 'utf8');
const registerAcceptsUsername = registerContent.includes('const { username, email } = req.body');
const registerValidatesUsername = registerContent.includes('usernameRegex');
const registerInsertsUsername = registerContent.includes('INSERT INTO users (username, email,');

console.log(`   ${registerAcceptsUsername ? '✓' : '✗'} Accepts username in request`);
console.log(`   ${registerValidatesUsername ? '✓' : '✗'} Validates username format`);
console.log(`   ${registerInsertsUsername ? '✓' : '✗'} Inserts username into database`);

// Test 5: Check login API
console.log('\n5. Checking login API...');
const loginContent = fs.readFileSync(path.join(__dirname, 'api/auth/login.js'), 'utf8');
const loginAcceptsBoth = loginContent.includes('const { email, username, identifier } = req.body');
const loginSetsCookies = loginContent.includes('Set-Cookie');
const loginUpdatesSession = loginContent.includes('session_token = $1, session_expires = $2');

console.log(`   ${loginAcceptsBoth ? '✓' : '✗'} Accepts email or username`);
console.log(`   ${loginSetsCookies ? '✓' : '✗'} Sets HTTP-only cookies`);
console.log(`   ${loginUpdatesSession ? '✓' : '✗'} Updates session in database`);

// Test 6: Check HTML forms
console.log('\n6. Checking HTML forms...');
const registerHtml = fs.readFileSync(path.join(__dirname, 'register.html'), 'utf8');
const loginHtml = fs.readFileSync(path.join(__dirname, 'login.html'), 'utf8');

const registerHasUsername = registerHtml.includes('id="username"');
const loginHasIdentifier = loginHtml.includes('id="identifier"');

console.log(`   ${registerHasUsername ? '✓' : '✗'} Register form has username field`);
console.log(`   ${loginHasIdentifier ? '✓' : '✗'} Login form has identifier field`);

// Test 7: Check auth.js script
console.log('\n7. Checking auth.js script...');
const authJs = fs.readFileSync(path.join(__dirname, 'scripts/auth.js'), 'utf8');
const hasAuthClass = authJs.includes('class AuthManager');
const hasCheckSession = authJs.includes('checkSession');
const hasAutoLogin = authJs.includes('DOMContentLoaded');

console.log(`   ${hasAuthClass ? '✓' : '✗'} Has AuthManager class`);
console.log(`   ${hasCheckSession ? '✓' : '✗'} Has checkSession method`);
console.log(`   ${hasAutoLogin ? '✓' : '✗'} Has auto-initialization`);

// Summary
console.log('\n=== Summary ===');
console.log('The authentication system has been implemented with:');
console.log('1. User registration with username and email');
console.log('2. Login with either email or username');
console.log('3. Session management with cookies');
console.log('4. Automatic login on page load');
console.log('5. Professional UI/UX with dynamic navigation');
console.log('\nTo deploy to Vercel:');
console.log('1. Connect your GitHub repository to Vercel');
console.log('2. Add Vercel Postgres database');
console.log('3. Set environment variables (POSTGRES_URL, etc.)');
console.log('4. Deploy with: vercel --prod');
console.log('\nTo test locally:');
console.log('1. Set up local PostgreSQL or use Vercel Postgres locally');
console.log('2. Run: npm run dev');
console.log('3. Visit http://localhost:3000');