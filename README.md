# DecentraForce Authentication System

A complete authentication system for the DecentraForce Web3 education platform, built for Vercel deployment with email-based authentication.

## Features

- **Email-only authentication**: Users register and login using only their email address
- **Email confirmation**: Users must type their email twice during registration for verification
- **Vercel Postgres integration**: Built-in database for storing user accounts
- **Serverless API**: Built with Vercel Serverless Functions
- **Responsive design**: Modern UI matching the DecentraForce brand
- **CORS enabled**: API endpoints configured for cross-origin requests

## Project Structure

```
├── index.html              # Main website homepage
├── login.html              # Login page
├── register.html           # Registration page (with email confirmation)
├── styles/                 # CSS styles directory
├── api/                    # Serverless API endpoints
│   └── auth/
│       ├── register.js     # User registration endpoint
│       └── login.js        # User login endpoint
├── lib/
│   └── db.js              # Database connection utilities
├── plans/                  # Project documentation
├── package.json           # Node.js dependencies
├── vercel.json            # Vercel deployment configuration
└── .env.example           # Environment variables template
```

## Setup Instructions

### 1. Prerequisites

- Node.js 18.x or higher
- Vercel account (free tier works)
- Vercel CLI (optional, for local development)

### 2. Local Development

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy environment variables template:
   ```bash
   cp .env.example .env.local
   ```

4. For local testing without a database, the API will work in demo mode.
   For full functionality, set up a local PostgreSQL database or use Vercel Postgres.

5. Run the development server:
   ```bash
   npm run dev
   ```

6. Open `http://localhost:3000` in your browser

### 3. Vercel Deployment

#### Option A: Deploy via Vercel Dashboard

1. Push your code to GitHub, GitLab, or Bitbucket
2. Go to [vercel.com](https://vercel.com) and import your repository
3. Vercel will automatically detect the configuration and deploy

#### Option B: Deploy via Vercel CLI

1. Install Vercel CLI:
   ```bash
   npm i -g vercel
   ```

2. Login to Vercel:
   ```bash
   vercel login
   ```

3. Deploy:
   ```bash
   vercel
   ```

4. For production deployment:
   ```bash
   vercel --prod
   ```

### 4. Setting Up Vercel Postgres

1. In your Vercel project dashboard, go to the "Storage" tab
2. Click "Create Database" and select "Postgres"
3. Choose a plan (Hobby tier is free)
4. Connect the database to your project
5. Vercel will automatically set the required environment variables

### 5. Environment Variables

The following environment variables are required for production:

| Variable | Description | Required for Production |
|----------|-------------|-------------------------|
| `POSTGRES_URL` | PostgreSQL connection string | Yes |
| `POSTGRES_PRISMA_URL` | Prisma-compatible connection string | Yes |
| `POSTGRES_URL_NON_POOLING` | Non-pooling connection string | Yes |
| `POSTGRES_USER` | Database username | Yes |
| `POSTGRES_HOST` | Database host | Yes |
| `POSTGRES_PASSWORD` | Database password | Yes |
| `POSTGRES_DATABASE` | Database name | Yes |
| `NODE_ENV` | Environment (development/production) | No |

**Note**: When you connect Vercel Postgres to your project, these variables are automatically set.

## API Endpoints

### POST `/api/auth/register`
Register a new user with email.

**Request:**
```json
{
  "email": "user@example.com"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Registration successful. Please check your email for verification.",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "verified": false
  }
}
```

### POST `/api/auth/login`
Login with email.

**Request:**
```json
{
  "email": "user@example.com"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Login successful",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "verified": true
  }
}
```

## Database Schema

The system uses a simple users table:

```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  verified BOOLEAN DEFAULT FALSE,
  verification_token VARCHAR(100),
  verification_expires TIMESTAMP WITH TIME ZONE
);
```

## Testing

### Manual Testing

1. Open the website (`index.html`)
2. Click "Log In" to go to the login page
3. Click "Create account" to go to the registration page
4. Try registering with an email (type it twice for confirmation)
5. Try logging in with the same email

### API Testing with curl

```bash
# Test registration
curl -X POST https://your-vercel-app.vercel.app/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'

# Test login
curl -X POST https://your-vercel-app.vercel.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
```

## Security Considerations

1. **Email validation**: Basic format validation is implemented
2. **Duplicate prevention**: Database enforces unique email constraint
3. **CORS**: API endpoints are configured for cross-origin requests
4. **Input sanitization**: Email addresses are trimmed and lowercased
5. **Error handling**: Generic error messages in production, detailed in development

## Next Steps & Enhancements

For a production-ready system, consider adding:

1. **Email verification**: Send actual verification emails
2. **Password authentication**: Add password support
3. **Session management**: Implement JWT or cookie-based sessions
4. **Rate limiting**: Prevent abuse of API endpoints
5. **Logging**: Comprehensive request/error logging
6. **Monitoring**: Health checks and performance monitoring
7. **Password reset**: Forgot password functionality

## Troubleshooting

### Common Issues

1. **"Database connection error"**: Ensure Vercel Postgres is connected and environment variables are set
2. **"CORS error"**: The API endpoints are configured for CORS. Check browser console for details
3. **"Email already registered"**: Each email can only be registered once
4. **"Invalid email format"**: Ensure email follows standard format (user@domain.com)

### Getting Help

- Check the browser console for JavaScript errors
- Check Vercel logs for API errors
- Review the `plans/authentication-system-plan.md` for architecture details

## License

MIT License - see LICENSE file for details

## Acknowledgments

- Built for the DecentraForce Web3 education platform
- Designed for Vercel serverless deployment
- Uses Vercel Postgres for database storage