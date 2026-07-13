# Neon Database Setup Guide

## Problem
You're getting "Network error. Please try again." when trying to create an account because:
1. Your application is configured to use Neon database (as shown in your Vercel environment variables)
2. The database connection is failing

## Solution

### Option 1: Use Neon Connection String Locally

1. **Get your Neon connection string:**
   - Go to your Neon dashboard (neon.tech)
   - Select your project
   - Click "Connection Details"
   - Copy the connection string (starts with `postgresql://` or `postgres://`)

2. **Update `.env.local` file:**
   Replace the localhost configuration with your Neon connection string:

   ```env
   # Neon Database Configuration
   POSTGRES_URL="postgresql://username:password@ep-cool-name-123456.us-east-1.aws.neon.tech/neondb"
   POSTGRES_PRISMA_URL="postgresql://username:password@ep-cool-name-123456.us-east-1.aws.neon.tech/neondb?pgbouncer=true"
   POSTGRES_URL_NON_POOLING="postgresql://username:password@ep-cool-name-123456.us-east-1.aws.neon.tech/neondb"
   POSTGRES_USER="username"
   POSTGRES_HOST="ep-cool-name-123456.us-east-1.aws.neon.tech"
   POSTGRES_PASSWORD="password"
   POSTGRES_DATABASE="neondb"
   
   # Application Settings
   NODE_ENV="development"
   JWT_SECRET="change_this_to_a_secure_random_string"
   SESSION_SECRET="change_this_to_another_secure_random_string"
   FRONTEND_URL="http://localhost:3000"
   ```

3. **Test the connection:**
   ```bash
   node test-db-connection.js
   ```

### Option 2: Deploy to Vercel (Recommended)

Since you already have Neon environment variables set in Vercel:

1. **Deploy your application to Vercel:**
   ```bash
   npm run deploy
   ```

2. **Access your deployed application:**
   - The environment variables will be automatically available
   - Use the Vercel-provided URL to test registration

### Option 3: Use Local PostgreSQL (For Development)

If you want to develop locally:

1. **Install PostgreSQL locally**
2. **Create a database:**
   ```bash
   createdb decentraforce_local
   ```
3. **Update `.env.local` with local credentials**
4. **Run the application locally:**
   ```bash
   npm run dev
   ```

## Database Configuration Fixed

I've updated the database configuration (`lib/db.js`) to:
- Use the standard `pg` package (compatible with Neon, Vercel Postgres, and local PostgreSQL)
- Properly parse connection strings
- Handle SSL configuration for production

## Next Steps

1. **Choose one of the options above**
2. **Update your `.env.local` file with the correct credentials**
3. **Test the connection:**
   ```bash
   node test-db-connection.js
   ```
4. **Run the development server:**
   ```bash
   npm run dev
   ```
5. **Test registration at:** `http://localhost:3000/register.html`

## Troubleshooting

If you still get "Network error":

1. **Check database connectivity:**
   ```bash
   node test-db-connection.js
   ```

2. **Verify Neon database is running:**
   - Check Neon dashboard
   - Ensure the database is active

3. **Check Vercel deployment logs:**
   - Go to Vercel dashboard > Your project > Logs
   - Look for database connection errors

4. **Test API endpoint directly:**
   ```bash
   curl -X POST http://localhost:3000/api/auth/register \
     -H "Content-Type: application/json" \
     -d '{"username":"testuser","email":"test@example.com"}'
   ```

The "Network error" should be resolved once your database connection is properly configured.