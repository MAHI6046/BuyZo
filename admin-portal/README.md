# DOT Admin Portal

Next.js admin portal for managing DOT catalog data.

## Local Run

```bash
cd admin-portal
npm install
npm run dev -- -p 3001
```

## Required Environment Variables

Create `admin-portal/.env.local` with:

```bash
BACKEND_BASE_URL=http://localhost:3000
ADMIN_PORTAL_API_KEY=same-value-as-backend
# Optional unless you use direct DB helpers in src/lib/db.ts
POSTGRES_URL=postgresql://...

# Firebase Web SDK (for email login UI)
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...

# Firebase Admin SDK (for server token/session verification)
# Use one of these:
FIREBASE_SERVICE_ACCOUNT_JSON={...}
# or
FIREBASE_SERVICE_ACCOUNT_PATH=../anydot-f9322-firebase-adminsdk-fbsvc-1e1c641843.json

# Comma/newline-separated email addresses allowed to access admin portal
ADMIN_ALLOWED_EMAILS=admin1@example.com,admin2@example.com

# Optional: set true only if you need Firebase token revocation checks on each request.
# Keeping this false improves admin API latency.
ADMIN_VERIFY_SESSION_REVOCATION=false
```

## Authentication Model

- Admin portal uses **Firebase email/password sign in** on `/login`.
- Only emails from `ADMIN_ALLOWED_EMAILS` can create an admin session.
- Admin session is stored in an HTTP-only cookie and required for all admin pages and `/api/*` routes.
- Admin portal API routes call backend `/api/admin/*` server-to-server using `ADMIN_PORTAL_API_KEY`; no direct DB access from the portal.
- This is separate from Flutter app auth logic: app users can still authenticate normally, while admin portal access is restricted by the allowlist above.
