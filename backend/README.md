# DOT Backend (Node.js + Vercel + Neon + R2 + Next.js Admin)

## Setup

1. Install dependencies:

```bash
cd backend
npm install
```

2. Create environment file:

```bash
cp .env.example .env
```

3. Apply schema to Neon:

```bash
psql 'postgresql://neondb_owner:npg_dWxz5JLQ1Mrt@ep-lucky-mountain-a7oownyn-pooler.ap-southeast-2.aws.neon.tech/neondb?sslmode=verify-full&channel_binding=require' -f schema.sql
```

4. Run API locally:

```bash
npm run dev
```

5. Run Admin Portal (Next.js App Router):

```bash
cd ../admin-portal
npm install
npm run dev -- -p 3001
```

## Required Environment Variables

- `POSTGRES_URL` = Neon PostgreSQL connection string
- `GOOGLE_MAPS_API_KEY` = Google Places + Geocoding key
- `R2_ACCESS_KEY_ID` = Cloudflare R2 access key
- `R2_SECRET_ACCESS_KEY` = Cloudflare R2 secret key
- `R2_BUCKET` = `logos`
- `R2_S3_ENDPOINT` = `https://9e681b73702dcc41c994e52d5b5f8216.r2.cloudflarestorage.com`
- `R2_PUBLIC_BASE_URL` = `https://pub-866258f4c59749ae92a01d084069b3ce.r2.dev`
- `ADMIN_PORTAL_URL` = URL of the Next.js admin portal (used by `/admin` redirect)
- `UPSTASH_REDIS_REST_URL` = Upstash Redis REST URL (for product list caching)
- `UPSTASH_REDIS_REST_TOKEN` = Upstash Redis REST token
- `UPSTASH_PRODUCTS_TTL_SECONDS` = optional cache TTL in seconds (clamped to 60-120, default 90)
- `STRIPE_PUBLISHABLE_KEY` = Stripe publishable key (frontend/mobile usage)
- `STRIPE_SECRET_KEY` = Stripe secret key (server-side payment intent creation)
- `STRIPE_WEBHOOK_SECRET` = Stripe webhook signing secret (`whsec_...`)
- `APP_CLIENT_KEY` = shared key required on every non-admin `/api/*` request via `x-app-client-key`
- `ADMIN_PORTAL_API_KEY` = shared key required on `/api/admin/*` via `x-admin-portal-key`
- `ENFORCE_APP_CHECK` = set to `true` (default) to require valid `x-firebase-appcheck` for non-admin `/api/*`
- `USE_APP_CHECK` = explicit on/off switch for backend App Check verification (overrides `ENFORCE_APP_CHECK`)
- `AUTO_INIT_SCHEMA` = set to `false` in production to skip runtime schema migration checks on each cold start (defaults to `true` only outside production)
- `OPENAI_API_KEY` = OpenAI API key used to generate product embeddings
- `OPENAI_EMBEDDING_MODEL` = embedding model name (default `text-embedding-3-small`)
- `OPENAI_EMBEDDING_DIMENSION` = embedding vector size (default `1536`)
- `PRODUCT_EMBEDDINGS_ENABLED` = set `true` to enable product embedding sync (default `true`)
- `PRODUCT_EMBEDDINGS_REQUIRED` = set `true` to fail writes when embedding sync cannot run (default `false`, backend logs and skips)
- Product embeddings are stored in Neon PostgreSQL using `pgvector` in table `product_embeddings`.
- `PRODUCT_SEARCH_SEMANTIC_ENABLED` = set `true` to enable semantic re-ranking in `/api/products` (default `true`)
- `PRODUCT_SEARCH_SEMANTIC_MIN_QUERY_LENGTH` = minimum query length for semantic vector re-ranking (default `5`)
- `PRODUCT_SEARCH_TRIGRAM_THRESHOLD` = trigram similarity threshold for fuzzy match candidate filtering (default `0.22`)
- `PRODUCT_SEARCH_VECTOR_MIN_SIMILARITY` = minimum vector similarity to include semantic-only candidates (default `0.18`)
- `PRODUCT_SEARCH_TEXT_WEIGHT` = final ranking text weight (default `0.5`)
- `PRODUCT_SEARCH_VECTOR_WEIGHT` = final ranking vector similarity weight (default `0.3`)
- `PRODUCT_SEARCH_POPULARITY_WEIGHT` = final ranking popularity weight (default `0.1`)
- `PRODUCT_SEARCH_STOCK_WEIGHT` = final ranking in-stock boost weight (default `0.1`)
- `PRODUCT_SEARCH_QUERY_CACHE_TTL_SECONDS` = in-memory TTL for query embeddings (default `3600`)
- `PRODUCT_SEARCH_QUERY_CACHE_MAX_ENTRIES` = max cached query embeddings in memory (default `300`)
- `PRODUCT_SEARCH_QUERY_EMBEDDING_TIMEOUT_MS` = max wait for query embedding generation before fallback (default `450`)
- `PRODUCT_SEARCH_QUERY_EMBEDDING_BACKOFF_SECONDS` = cooldown after OpenAI quota/rate-limit errors (default `300`)
- `DOTBOT_ENABLED` = set `true` to enable DOTBOT endpoints (default `true`)
- `DOTBOT_LLM_MODEL` = model for intent detection + conversation reply (default `gpt-4o-mini`)
- `DOTBOT_STT_MODEL` = speech-to-text model (default `gpt-4o-mini-transcribe`)
- `DOTBOT_TTS_MODEL` = text-to-speech model (default `gpt-4o-mini-tts`)
- `DOTBOT_TTS_VOICE` = TTS voice (default `alloy`)
- `DOTBOT_MATCH_DISTANCE_THRESHOLD` = semantic match threshold for pgvector search (default `0.4`)

## Vercel Deployment

1. Import `backend` folder as a Vercel project.
2. Add all vars above in Vercel Project Settings.
3. Deploy.

Production URL:

- `https://anydot-backend.vercel.app`

## Firebase App Check Setup (Required)

1. In Firebase Console -> **Build** -> **App Check**, register your app:
   - Android app: `com.anydot.app`
   - iOS app: `com.anydot.app`
2. Enable providers:
   - Android: **Play Integrity**
   - iOS: **App Attest** (with DeviceCheck fallback)
3. For local debug builds, add your debug token in App Check Debug Tokens.
4. Keep backend `ENFORCE_APP_CHECK=true` in production.
5. Run Flutter with your backend and app key defines:

```bash
flutter run -t lib/main_driver.dart \
  --dart-define=BACKEND_BASE_URL=https://anydot-backend.vercel.app \
  --dart-define=APP_CLIENT_KEY=<APP_CLIENT_KEY> \
  --dart-define=USE_APP_CHECK=true
```

## Admin Portal (Next.js App Router)

- Location: `admin-portal` (repo root)
- Local URL (default): `http://localhost:3001`
- Backend `/admin` endpoint now redirects to `ADMIN_PORTAL_URL` when set.
- Feature set:
  - Upload images to Cloudflare R2 via presigned URL
  - Create product with pricing, variants, highlights, nutrition
  - Category dropdown from DB + add new categories
  - Store everything in Neon schema

## API Endpoints

- `GET /`
- `GET /api/health`
- `GET /api/products`
  - Supports pagination with `limit` (20-30), plus either `cursor` or `offset`
  - Optional filters: `q`, `category`, `store`
  - Search uses Neon full-text (`tsvector`) + trigram (`pg_trgm`) + optional semantic re-ranking (`pgvector`)
  - Default hybrid score:
    - `0.5 * Text Rank + 0.3 * Vector Similarity + 0.1 * Popularity + 0.1 * In-Stock Boost`
  - Popularity is derived from precomputed `product_popularity.total_qty` (updated on checkout)
  - Search requests (`q`) are served in offset mode for stable relevance ordering
  - Returns `pageInfo` with `hasMore`, `nextCursor`, and `nextOffset` (offset mode)
- `GET /api/products/:productId`
- `POST /api/checkout`
  - Validates stock and deducts inventory inside a Neon transaction (`FOR UPDATE`)
  - Creates `orders` + `order_items` atomically
  - Returns `409` on stock conflict
- `GET /api/orders?firebase_uid=...&type=active|previous`
- `POST /api/create-payment-intent`
  - Validates stock + creates order in Neon (if `order_id` not provided)
  - Calculates amount server-side from `order_items` (never trusts frontend amount)
  - Creates Stripe PaymentIntent and returns `client_secret`
- `POST /api/stripe/webhook`
  - Verifies Stripe signature (`STRIPE_WEBHOOK_SECRET`)
  - Marks order paid only on confirmed Stripe events
- `POST /api/payments/create-intent` (alias of `/api/create-payment-intent`)
- `GET /api/admin/products`
- `GET /api/admin/dashboard-stats`
- `GET /api/admin/products/:productId`
- `POST /api/admin/products`
- `PUT /api/admin/products/:productId`
- `DELETE /api/admin/products/:productId`
- `DELETE /api/admin/categories/:categoryId`
- `POST /api/admin/upload-url`
- `POST /api/dotbot/message`
- `POST /api/dotbot/transcribe`
- `POST /api/dotbot/tts`
- `POST /api/location/autocomplete`
- `GET /api/location/place-details?placeId=...`
- `GET /api/location/reverse-geocode?lat=...&lng=...`
- `GET /api/users/:firebaseUid`
- `POST /api/users`
- `DELETE /api/users/:firebaseUid`
