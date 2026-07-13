# Database Setup Guide for DecentraForce Authentication System

## Summary
Your authentication system has been successfully pushed to GitHub. The system is configured to use **Vercel Postgres** (PostgreSQL) as the database. Here's what you need to do to set up the database:

## Which Vercel Storage Option Should You Choose?

When you click "Storage" on Vercel, you'll see multiple options. Here's what each one is for and which one you should choose:

| Option | Purpose | Recommended for Authentication? |
|--------|---------|--------------------------------|
| **Vercel Postgres** | Serverless PostgreSQL database | ✅ **YES** - This is what your project is configured for |
| **Neon** | Serverless Postgres with branching | ✅ Alternative option (also PostgreSQL) |
| **Supabase** | Postgres backend with additional features | ✅ Alternative option (also PostgreSQL) |
| **AWS** | Serverless PostgreSQL and NoSQL | ⚠️ Possible but more complex |
| **Upstash** | Serverless Redis (key-value store) | ❌ Not suitable for user data storage |
| **Redis** | Serverless Redis cache | ❌ For caching, not primary database |
| **Edge Config** | Ultra-low latency configuration storage | ❌ Not a database |
| **Blob** | Fast object storage for files | ❌ For file storage, not databases |

**Your Choice: Vercel Postgres** - Your authentication system code (`lib/db.js`) is already configured to use the `@vercel/postgres` package, so this is the easiest and recommended option.

## 1. Vercel Postgres Setup

### Step-by-Step Instructions:

1. **Go to your Vercel Dashboard**
   - Visit [vercel.com](https://vercel.com)
   - Log in to your account
   - Select your project (DecentraForce)

2. **Navigate to Storage**
   - In your project dashboard, click on the **"Storage"** tab
   - Click **"Connect Database"**

3. **Create a New PostgreSQL Database**
   - Select **"Create New"** → **"Postgres"**
   - Choose a name for your database (e.g., `decentraforce-db`)
   - Select a region closest to your users
   - Click **"Create"**

4. **Connect to Your Project**
   - Vercel will automatically detect your project's database configuration
   - It will add the required environment variables to your project

5. **Verify Environment Variables**
   - Go to **Project Settings** → **Environment Variables**
   - You should see the following variables automatically added by Vercel:
     - `POSTGRES_URL`
     - `POSTGRES_PRISMA_URL`
     - `POSTGRES_URL_NON_POOLING`
     - `POSTGRES_USER`
     - `POSTGRES_HOST`
     - `POSTGRES_PASSWORD`
     - `POSTGRES_DATABASE`

## 2. Manual Environment Variables (If Needed)

If Vercel doesn't automatically add the variables, you can add them manually:

1. In your Vercel project, go to **Settings** → **Environment Variables**
2. Add the following variables (get the values from your Vercel Postgres dashboard):
   ```
   POSTGRES_URL=postgres://username:password@host:port/database
   POSTGRES_PRISMA_URL=postgres://username:password@host:port/database?pgbouncer=true&connect_timeout=15
   POSTGRES_URL_NON_POOLING=postgres://username:password@host:port/database
   POSTGRES_USER=username
   POSTGRES_HOST=host
   POSTGRES_PASSWORD=password
   POSTGRES_DATABASE=database
   ```
3. Also add these optional variables:
   ```
   NODE_ENV=production
   FRONTEND_URL=https://your-domain.vercel.app
   JWT_SECRET=your_secure_jwt_secret_key
   ```

## 3. Database Schema Initialization

The database schema will be automatically initialized when the application first runs. The `lib/db.js` file includes an `initDatabase()` function that creates the necessary tables:

- **users table** with fields: id, username, email, created_at, verified, verification_token, verification_expires, session_token, session_expires

## 4. Testing the Database Connection

### Option A: Test via Vercel Deployment
1. Deploy your project on Vercel (it should auto-deploy after pushing to GitHub)
2. Visit your deployed URL
3. The application will attempt to initialize the database on first API call

### Option B: Local Testing
1. Install PostgreSQL locally
2. Update `.env.local` with your local database credentials
3. Run the test script:
   ```bash
   node test-db-connection.js
   ```

## 5. Troubleshooting

### Common Issues:

1. **"Database connection failed"**
   - Ensure Vercel Postgres is properly connected to your project
   - Check that environment variables are set in Vercel
   - Verify the database is running (in Vercel Storage dashboard)

2. **"Table does not exist"**
   - The schema initialization might have failed
   - Restart your Vercel deployment
   - Or manually trigger the `initDatabase()` function

3. **Environment variables not loading**
   - Make sure variables are added to the correct environment (Production)
   - Redeploy after adding new environment variables

## 6. Next Steps

1. **Test the Authentication System**
   - Visit your deployed application
   - Try registering a new account
   - Test login functionality

2. **Monitor Database Usage**
   - Check the Vercel Storage dashboard for database metrics
   - Monitor query performance

3. **Scale as Needed**
   - Vercel Postgres automatically scales
   - Consider adding connection pooling for high traffic

## 7. Security Notes

- **Never commit `.env.local` to version control** (it's already in `.gitignore`)
- **Use strong JWT secrets** in production
- **Enable SSL** for database connections (already configured in `lib/db.js`)
- **Regularly backup** your database through Vercel dashboard

## 8. Support

If you encounter issues:
1. Check the Vercel documentation: [Vercel Postgres Docs](https://vercel.com/docs/storage/vercel-postgres)
2. Review the application logs in Vercel dashboard
3. Test locally with a PostgreSQL instance

Your authentication system is now ready for production use with Vercel Postgres!