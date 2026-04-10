const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
dotenv.config({ path: path.join(__dirname, '..', '.env') });
const { randomUUID, timingSafeEqual } = require('crypto');
const firebaseAdmin = require('firebase-admin');
const { createAppWithCors } = require('../src/app/bootstrap');
const { pool } = require('../src/infra/db');
const { createCacheRuntime } = require('../src/infra/cache');
const { createRealtimeServices } = require('../src/infra/realtime');
const { createCheckoutItemUtils, createPricingUtils } = require('../src/domains/checkout');
const {
  ACTIVE_ORDER_STATUSES,
  PREVIOUS_ORDER_STATUSES,
  DRIVER_UPDATABLE_STATUSES,
} = require('../src/domains/orders');
const { createPaymentConfig } = require('../src/domains/payments');
const { createUserIdentityUtils } = require('../src/users/identity');
const { createUserDisplayNameUtils } = require('../src/users/display-names');
const { createReferralRewardUtils } = require('../src/finance/referrals');
const { createDriverOrderUtils } = require('../src/drivers/orders');
const { parseInteger, clamp } = require('../src/utils/numbers');
const {
  parseNullableNumber,
  roundCurrencyAmount,
  generateOrderIntegrityHash,
  coerceFeeType,
  parseSqlTimeOrNull,
  timeInWindow,
  toTimeSegments,
  segmentsOverlap,
  amountRangesOverlap,
  optionalDimensionOverlaps,
  haversineDistanceKm,
} = require('../src/checkout/math');
const {
  coercePromoDiscountType,
  normalizePromoCodeForStorage,
  parseOptionalTimestamp,
  normalizePhoneNumber,
  normalizeDisplayName,
  normalizePromoCode,
  normalizeReferralCode,
  normalizeFavoriteBookLabel,
} = require('../src/normalizers');
const { registerApiRoutes } = require('../http/routes');
const { createServiceRegistry } = require('../http/services');
const { createErrorMiddleware } = require('../http/middleware');

const app = createAppWithCors({
  nodeEnv: process.env.NODE_ENV,
  configuredOriginsRaw: process.env.CORS_ALLOWED_ORIGINS,
});

let productEmbeddingsModule = null;
function getProductEmbeddings() {
  if (!productEmbeddingsModule) {
    productEmbeddingsModule = require('../src/product-embeddings');
  }
  return productEmbeddingsModule;
}

let dotbotModule = null;
function getDotbotModule() {
  if (!dotbotModule) {
    dotbotModule = require('../src/dotbot');
  }
  return dotbotModule;
}

function parseBooleanEnv(value, fallback) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  return normalized === 'true';
}

function loadFirebaseServiceAccountJson() {
  const inlineJson = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (inlineJson) {
    return inlineJson;
  }

  const configuredPath = String(process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '').trim();
  if (!configuredPath) {
    return '';
  }

  const resolvedPath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(__dirname, '..', configuredPath);

  try {
    return fs.readFileSync(resolvedPath, 'utf8').trim();
  } catch (error) {
    throw new Error(
      `Unable to read FIREBASE_SERVICE_ACCOUNT_PATH at ${resolvedPath}: ${error.message}`,
    );
  }
}

const { stripeSecretKey, stripeWebhookSecret, stripePublishableKey, PLATFORM_CURRENCY, stripeClient } =
  createPaymentConfig(process.env);
const appClientKey = (process.env.APP_CLIENT_KEY || '').trim();
const adminPortalApiKey = (process.env.ADMIN_PORTAL_API_KEY || '').trim();
const adminPortalApiKeysRaw = String(process.env.ADMIN_PORTAL_API_KEYS || '').trim();
const adminPortalLegacyKey = String(process.env.ADMIN_PORTAL_API_KEY_LEGACY || '').trim();
const adminRouteAcceptedKeys = Array.from(
  new Set(
    [
      adminPortalApiKey,
      adminPortalLegacyKey,
      ...adminPortalApiKeysRaw
        .split(/[,\n;]/)
        .map((entry) => String(entry || '').trim())
        .filter(Boolean),
    ].filter(Boolean),
  ),
);
const useAppCheckEnv = String(process.env.USE_APP_CHECK || '').trim().toLowerCase();
const enforceAppCheck =
  (useAppCheckEnv
    ? useAppCheckEnv === 'true'
    : String(process.env.ENFORCE_APP_CHECK || 'true').trim().toLowerCase() !==
      'false');
const autoInitSchema = parseBooleanEnv(
  process.env.AUTO_INIT_SCHEMA,
  process.env.NODE_ENV !== 'production',
);
let firebaseAdminReady = false;
let firebaseCanCheckRevocation = false;

function keysMatch(provided, expected) {
  const providedBuffer = Buffer.from(String(provided || ''), 'utf8');
  const expectedBuffer = Buffer.from(String(expected || ''), 'utf8');
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

function getFirebaseAdminAppCheck() {
  getFirebaseAdminAuth();
  return firebaseAdmin.appCheck();
}

function getFirebaseAdminAuth() {
  if (!firebaseAdminReady) {
    if (firebaseAdmin.apps.length === 0) {
      const rawServiceAccount = loadFirebaseServiceAccountJson();
      const projectId = (process.env.FIREBASE_PROJECT_ID || '').trim();
      if (rawServiceAccount) {
        let serviceAccount = null;
        try {
          serviceAccount = JSON.parse(rawServiceAccount);
        } catch (_error) {
          serviceAccount = null;
        }
        const effectiveProjectId =
          (serviceAccount?.project_id || '').trim() || projectId || undefined;
        const hasServiceKeys =
          typeof serviceAccount?.client_email === 'string' &&
          serviceAccount.client_email.trim().length > 0 &&
          typeof serviceAccount?.private_key === 'string' &&
          serviceAccount.private_key.trim().length > 0;

        if (hasServiceKeys) {
          firebaseAdmin.initializeApp({
            credential: firebaseAdmin.credential.cert(serviceAccount),
            projectId: effectiveProjectId,
          });
          firebaseCanCheckRevocation = true;
        } else if (effectiveProjectId) {
          // Fallback: token signature verification only (no revocation checks).
          firebaseAdmin.initializeApp({ projectId: effectiveProjectId });
          firebaseCanCheckRevocation = false;
        } else {
          throw new Error(
            'Firebase Admin is not configured. Set valid FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_PROJECT_ID',
          );
        }
      } else if (projectId) {
        firebaseAdmin.initializeApp({ projectId });
        firebaseCanCheckRevocation = false;
      } else {
        throw new Error(
          'Firebase Admin is not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_PROJECT_ID',
        );
      }
    }
    firebaseAdminReady = true;
  }
  return firebaseAdmin.auth();
}

function getFirebaseAdminFirestore() {
  getFirebaseAdminAuth();
  return firebaseAdmin.firestore();
}

const {
  publishOrderRealtimeUpdate,
  publishOrderRealtimeUpdateFromRow,
  enqueueWalletRealtimeSync,
  processPendingWalletRealtimeSync,
  publishUserRealtimeWalletSnapshot,
} = createRealtimeServices({
  db: {
    withClient: async (handler) => {
      const client = await pool.connect();
      try {
        return await handler(client);
      } finally {
        client.release();
      }
    },
  },
  logger: console,
  getFirebaseAdminFirestore,
  parseInteger,
  normalizeReferralCode,
  roundCurrencyAmount,
  platformCurrency: PLATFORM_CURRENCY,
});

const walletSyncRetryEnabled = parseBooleanEnv(
  process.env.WALLET_SYNC_RETRY_ENABLED,
  true,
);
const walletSyncDrainIntervalMs = Math.max(
  5_000,
  Number.parseInt(process.env.WALLET_SYNC_DRAIN_INTERVAL_MS || '30000', 10) || 30_000,
);
let lastWalletSyncDrainAt = 0;
let walletSyncDrainInFlight = null;

async function maybeDrainWalletSyncOutboxOnRequest() {
  if (!walletSyncRetryEnabled) return;
  const now = Date.now();
  if (now - lastWalletSyncDrainAt < walletSyncDrainIntervalMs) return;
  if (walletSyncDrainInFlight) return;
  lastWalletSyncDrainAt = now;
  walletSyncDrainInFlight = processPendingWalletRealtimeSync({ limit: 10 })
    .catch((error) => {
      console.warn(`Wallet sync outbox drain failed: ${error.message}`);
    })
    .finally(() => {
      walletSyncDrainInFlight = null;
    });
  await walletSyncDrainInFlight;
}

async function requireFirebaseAuth(req, res, next) {
  try {
    const authHeader = String(req.headers.authorization || '');
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ ok: false, message: 'Missing Authorization bearer token' });
    }
    const idToken = authHeader.substring('Bearer '.length).trim();
    if (!idToken) {
      return res.status(401).json({ ok: false, message: 'Missing Firebase ID token' });
    }

    const decoded = await getFirebaseAdminAuth().verifyIdToken(
      idToken,
      firebaseCanCheckRevocation,
    );
    req.auth = {
      uid: String(decoded.uid || ''),
      token: decoded,
    };
    if (!req.auth.uid) {
      return res.status(401).json({ ok: false, message: 'Invalid Firebase token payload' });
    }
    return next();
  } catch (error) {
    if (
      String(error?.message || '').includes('Firebase Admin is not configured') ||
      String(error?.message || '').includes('Unable to detect a Project Id') ||
      error?.code === 'app/invalid-credential'
    ) {
      return res.status(500).json({ ok: false, message: 'Firebase auth is not configured on server' });
    }
    if (error.code?.startsWith?.('auth/')) {
      return res.status(401).json({ ok: false, message: 'Invalid or expired Firebase token' });
    }
    return next(error);
  }
}

async function requireDriverRole(req, res, next) {
  try {
    const firebaseUid = String(req.auth?.uid || '').trim();
    const tokenPhone = normalizePhoneNumber(req.auth?.token?.phone_number);
    if (!firebaseUid) {
      return res.status(401).json({ ok: false, message: 'Unauthenticated request' });
    }
    if (!tokenPhone) {
      return res.status(403).json({
        ok: false,
        message: 'Driver account must have a verified phone number',
      });
    }

    const accessRes = await pool.query(
      `
      SELECT id, phone_number, display_name
      FROM driver_access
      WHERE phone_number = $1
        AND is_active = TRUE
      LIMIT 1
      `,
      [tokenPhone],
    );
    if (accessRes.rowCount === 0) {
      return res.status(403).json({
        ok: false,
        message: 'This phone number is not approved for driver access',
      });
    }

    const displayName = String(
      req.auth?.token?.name || req.auth?.token?.display_name || accessRes.rows[0].display_name || '',
    ).trim();
    const upserted = await pool.query(
      `
      INSERT INTO users (firebase_uid, phone_number, display_name, role)
      VALUES ($1, $2, $3, 'driver')
      ON CONFLICT (firebase_uid)
      DO UPDATE SET
        phone_number = COALESCE(EXCLUDED.phone_number, users.phone_number),
        display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), users.display_name),
        role = 'driver',
        updated_at = NOW()
      RETURNING id, firebase_uid, phone_number, display_name, role
      `,
      [firebaseUid, tokenPhone, displayName || null],
    );

    req.driver = {
      user: upserted.rows[0],
      approvedPhone: tokenPhone,
    };
    return next();
  } catch (error) {
    return next(error);
  }
}

app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    await ensurePricingSchema();
    await ensureDriverOrderColumns();
    if (!stripeClient || !stripeWebhookSecret) {
      return res.status(500).json({
        ok: false,
        message: 'Stripe webhook is not configured',
      });
    }

    const signature = req.headers['stripe-signature'];
    if (!signature || typeof signature !== 'string') {
      return res.status(400).send('Missing stripe-signature header');
    }

    const event = stripeClient.webhooks.constructEvent(req.body, signature, stripeWebhookSecret);
    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object;
      const webhookClient = await pool.connect();
      let updated;
      try {
        await webhookClient.query('BEGIN');
        const eventInsert = await webhookClient.query(
          `
          INSERT INTO stripe_webhook_events (event_id, event_type, status, processed_at)
          VALUES ($1, $2, 'processed', NOW())
          ON CONFLICT (event_id) DO NOTHING
          RETURNING event_id
          `,
          [String(event.id || ''), String(event.type || '')],
        );
        if (eventInsert.rowCount === 0) {
          await webhookClient.query('ROLLBACK');
          return res.status(200).json({ received: true, duplicate: true });
        }
        updated = await webhookClient.query(
          `
          UPDATE orders
          SET payment_status = 'paid',
              status = 'confirmed',
              payment_method = 'stripe',
              delivery_pin = COALESCE(
                NULLIF(BTRIM(delivery_pin), ''),
                LPAD((FLOOR(RANDOM() * 10000))::int::text, 4, '0')
              ),
              delivery_pin_generated_at = COALESCE(delivery_pin_generated_at, NOW()),
              updated_at = NOW()
          WHERE stripe_payment_intent_id = $1
             OR id = COALESCE($2::bigint, -1)
          RETURNING id, firebase_uid, promo_id, delivery_credit_used, delivery_fee_waived, order_credit_used_amount, status, payment_status, currency, item_total, subtotal, delivery_fee, discount_amount, platform_fee, total_amount, delivery_pin, delivery_pin_generated_at, delivery_pin_verified_at, created_at, updated_at
          `,
          [intent.id, Number(intent.metadata?.order_id || 0)],
        );

        for (const row of updated.rows) {
          if (!row.promo_id) continue;
          const usageInsert = await webhookClient.query(
            `
            INSERT INTO promo_usages (promo_id, user_id, order_id, used_at)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (order_id, promo_id) DO NOTHING
            RETURNING id
            `,
            [row.promo_id, String(row.firebase_uid || '').trim(), Number(row.id)],
          );
          if (usageInsert.rowCount > 0) {
            await webhookClient.query(
              `
              UPDATE promo_codes
              SET used_count = used_count + 1,
                  updated_at = NOW()
              WHERE id = $1
              `,
              [row.promo_id],
            );
          }

          if (row.delivery_credit_used === true) {
            const resolvedUserId = await resolveUserIdFromIdentity(
              webhookClient,
              String(row.firebase_uid || '').trim(),
            );
            if (resolvedUserId) {
              await webhookClient.query(
                `
                INSERT INTO delivery_credit_transactions (user_id, type, credits, order_id, source, created_at)
                VALUES ($1, 'used', -1, $2, 'order_delivery_fee_waiver', NOW())
                ON CONFLICT (order_id, user_id, type) DO NOTHING
                `,
                [resolvedUserId, Number(row.id)],
              );
            }
          }

          const orderCreditUsedAmount = roundCurrencyAmount(
            Number(row.order_credit_used_amount || 0),
          );
          let finalizedReservedAmount = 0;
          const reservationRes = await webhookClient.query(
            `
            SELECT id, amount
            FROM order_credit_reservations
            WHERE order_id = $1
              AND status = 'pending'
            ORDER BY created_at DESC
            LIMIT 1
            FOR UPDATE
            `,
            [Number(row.id)],
          );
          if (reservationRes.rowCount > 0) {
            finalizedReservedAmount = roundCurrencyAmount(
              Number(reservationRes.rows[0].amount || 0),
            );
            await webhookClient.query(
              `
              UPDATE order_credit_reservations
              SET status = 'finalized',
                  payment_intent_id = COALESCE(payment_intent_id, $2),
                  updated_at = NOW()
              WHERE id = $1
              `,
              [reservationRes.rows[0].id, intent.id],
            );
          }
          const creditAmountToDeduct = finalizedReservedAmount > 0
            ? finalizedReservedAmount
            : orderCreditUsedAmount;
          if (creditAmountToDeduct > 0) {
            const resolvedUserId = await resolveUserIdFromIdentity(
              webhookClient,
              String(row.firebase_uid || '').trim(),
            );
            if (resolvedUserId) {
              await webhookClient.query(
                `
                INSERT INTO order_credit_transactions (user_id, type, amount, order_id, source, created_at)
                VALUES ($1, 'used', $2, $3, 'checkout_auto_apply', NOW())
                ON CONFLICT (order_id, source, type) DO NOTHING
                `,
                [resolvedUserId, creditAmountToDeduct, Number(row.id)],
              );
            }
          }

          await maybeCompleteReferralRewardForFirstPaidOrder(webhookClient, {
            firebaseUid: String(row.firebase_uid || '').trim(),
            orderId: Number(row.id),
          });
        }
        await webhookClient.query('COMMIT');
      } catch (txError) {
        try {
          await webhookClient.query('ROLLBACK');
        } catch (_rollbackError) {}
        throw txError;
      } finally {
        webhookClient.release();
      }
      const affectedUids = new Set(
        updated.rows
          .map((row) => String(row.firebase_uid || '').trim())
          .filter(Boolean),
      );
      const metadataUid = String(intent.metadata?.firebase_uid || '').trim();
      if (metadataUid) affectedUids.add(metadataUid);
      await Promise.all([...affectedUids].map((uid) => bumpOrdersCacheVersion(uid)));
      await Promise.all(updated.rows.map((row) => publishOrderRealtimeUpdateFromRow(row)));
      await Promise.all(
        [...affectedUids].map((uid) => publishUserRealtimeWalletSnapshot(pool, uid)),
      );
    } else if (event.type === 'payment_intent.payment_failed') {
      const intent = event.data.object;
      const webhookClient = await pool.connect();
      let updated;
      try {
        await webhookClient.query('BEGIN');
        const eventInsert = await webhookClient.query(
          `
          INSERT INTO stripe_webhook_events (event_id, event_type, status, processed_at)
          VALUES ($1, $2, 'processed', NOW())
          ON CONFLICT (event_id) DO NOTHING
          RETURNING event_id
          `,
          [String(event.id || ''), String(event.type || '')],
        );
        if (eventInsert.rowCount === 0) {
          await webhookClient.query('ROLLBACK');
          return res.status(200).json({ received: true, duplicate: true });
        }
        updated = await webhookClient.query(
          `
          UPDATE orders
          SET payment_status = 'failed',
              status = 'failed',
              updated_at = NOW()
          WHERE stripe_payment_intent_id = $1
             OR id = COALESCE($2::bigint, -1)
          RETURNING id, firebase_uid, status, payment_status, currency, item_total, subtotal, delivery_fee, discount_amount, order_credit_used_amount, platform_fee, total_amount, delivery_pin, delivery_pin_generated_at, delivery_pin_verified_at, created_at, updated_at
          `,
          [intent.id, Number(intent.metadata?.order_id || 0)],
        );
        await webhookClient.query(
          `
          UPDATE order_credit_reservations
          SET status = 'released',
              updated_at = NOW()
          WHERE status = 'pending'
            AND (
              payment_intent_id = $1
              OR order_id = COALESCE($2::bigint, -1)
            )
          `,
          [intent.id, Number(intent.metadata?.order_id || 0)],
        );
        await webhookClient.query('COMMIT');
      } catch (txError) {
        try {
          await webhookClient.query('ROLLBACK');
        } catch (_rollbackError) {}
        throw txError;
      } finally {
        webhookClient.release();
      }
      const affectedUids = new Set(
        updated.rows
          .map((row) => String(row.firebase_uid || '').trim())
          .filter(Boolean),
      );
      const metadataUid = String(intent.metadata?.firebase_uid || '').trim();
      if (metadataUid) affectedUids.add(metadataUid);
      await Promise.all([...affectedUids].map((uid) => bumpOrdersCacheVersion(uid)));
      await Promise.all(updated.rows.map((row) => publishOrderRealtimeUpdateFromRow(row)));
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Stripe webhook error:', error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }
});

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(async (req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  if (req.path.startsWith('/api/admin/')) return next();

  if (!appClientKey) {
    return res.status(503).json({
      ok: false,
      message: 'APP_CLIENT_KEY is not configured on server',
    });
  }

  const providedKey = String(req.headers['x-app-client-key'] || '').trim();
  if (!providedKey || !keysMatch(providedKey, appClientKey)) {
    return res.status(403).json({ ok: false, message: 'Forbidden' });
  }

  if (enforceAppCheck) {
    const appCheckToken = String(req.headers['x-firebase-appcheck'] || '').trim();
    if (!appCheckToken) {
      return res
        .status(401)
        .json({ ok: false, message: 'Missing Firebase App Check token' });
    }
    try {
      const decodedToken = await getFirebaseAdminAppCheck().verifyToken(
        appCheckToken,
      );
      req.appCheck = {
        appId: decodedToken.app_id || '',
      };
    } catch (error) {
      if (
        String(error?.message || '').includes('Firebase Admin is not configured') ||
        String(error?.message || '').includes('Unable to detect a Project Id') ||
        error?.code === 'app/invalid-credential'
      ) {
        return res.status(500).json({
          ok: false,
          message: 'Firebase App Check is not configured on server',
        });
      }
      return res.status(401).json({
        ok: false,
        message: 'Invalid Firebase App Check token',
      });
    }
  }
  return next();
});

app.use((req, res, next) => {
  if (!req.path.startsWith('/api/admin/')) return next();

  if (adminRouteAcceptedKeys.length === 0) {
    return res.status(503).json({
      ok: false,
      message: 'ADMIN_PORTAL_API_KEY is not configured on server',
    });
  }

  const providedKey = String(req.headers['x-admin-portal-key'] || '').trim();
  const keyMatches = providedKey
    ? adminRouteAcceptedKeys.some((acceptedKey) => keysMatch(providedKey, acceptedKey))
    : false;
  if (!keyMatches) {
    return res.status(403).json({ ok: false, message: 'Forbidden' });
  }
  return next();
});

const schemaSql = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  firebase_uid VARCHAR(128) NOT NULL UNIQUE,
  phone_number VARCHAR(20),
  display_name VARCHAR(120),
  referral_code TEXT UNIQUE,
  referred_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  role VARCHAR(30) NOT NULL DEFAULT 'customer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS driver_access (
  id BIGSERIAL PRIMARY KEY,
  phone_number VARCHAR(20) NOT NULL UNIQUE,
  display_name VARCHAR(120),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users
ADD COLUMN IF NOT EXISTS role VARCHAR(30) NOT NULL DEFAULT 'customer';

CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  store_id VARCHAR(80) NOT NULL DEFAULT 'default',
  slug VARCHAR(160) UNIQUE,
  name VARCHAR(160) NOT NULL,
  short_description TEXT,
  description TEXT,
  category VARCHAR(80),
  brand VARCHAR(80),
  is_veg BOOLEAN,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  price_mrp NUMERIC(10,2) NOT NULL,
  price_sale NUMERIC(10,2) NOT NULL,
  stock_qty INTEGER NOT NULL DEFAULT 0,
  primary_image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE products
ADD COLUMN IF NOT EXISTS store_id VARCHAR(80) NOT NULL DEFAULT 'default';

ALTER TABLE products
ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE TABLE IF NOT EXISTS categories (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  slug VARCHAR(120) NOT NULL UNIQUE,
  image_url TEXT,
  parent_id BIGINT REFERENCES categories(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE categories
ADD COLUMN IF NOT EXISTS parent_id BIGINT REFERENCES categories(id) ON DELETE SET NULL;

ALTER TABLE categories
ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

ALTER TABLE categories
ADD COLUMN IF NOT EXISTS image_url TEXT;

ALTER TABLE products
ADD COLUMN IF NOT EXISTS category_id BIGINT REFERENCES categories(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS product_images (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_variants (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  label VARCHAR(80) NOT NULL,
  grams INTEGER,
  size_code VARCHAR(30),
  mrp NUMERIC(10,2) NOT NULL,
  sale_price NUMERIC(10,2) NOT NULL,
  stock_qty INTEGER NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_highlights (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  highlight TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS product_nutrition (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  nutrient VARCHAR(100) NOT NULL,
  value VARCHAR(100) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS product_embeddings (
  product_id BIGINT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  embedding vector(1536) NOT NULL,
  embedding_model VARCHAR(120) NOT NULL,
  source_text TEXT NOT NULL,
  metadata JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_popularity (
  product_id BIGINT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  total_qty BIGINT NOT NULL DEFAULT 0,
  last_ordered_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS favorite_books (
  id BIGSERIAL PRIMARY KEY,
  user_firebase_uid VARCHAR(128) NOT NULL,
  label VARCHAR(40) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_firebase_uid, label)
);

CREATE TABLE IF NOT EXISTS product_favorites (
  id BIGSERIAL PRIMARY KEY,
  user_firebase_uid VARCHAR(128) NOT NULL,
  book_id BIGINT REFERENCES favorite_books(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE product_favorites
ADD COLUMN IF NOT EXISTS book_id BIGINT REFERENCES favorite_books(id) ON DELETE CASCADE;

ALTER TABLE product_favorites
DROP CONSTRAINT IF EXISTS product_favorites_user_firebase_uid_product_id_key;

INSERT INTO favorite_books (user_firebase_uid, label, sort_order, created_at, updated_at)
SELECT DISTINCT
  pf.user_firebase_uid,
  'Favorites',
  0,
  NOW(),
  NOW()
FROM product_favorites pf
WHERE pf.user_firebase_uid IS NOT NULL
  AND BTRIM(pf.user_firebase_uid) <> ''
ON CONFLICT (user_firebase_uid, label) DO NOTHING;

UPDATE product_favorites pf
SET book_id = fb.id
FROM favorite_books fb
WHERE pf.book_id IS NULL
  AND pf.user_firebase_uid = fb.user_firebase_uid
  AND fb.label = 'Favorites';

CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  firebase_uid VARCHAR(128),
  delivery_address_text TEXT,
  delivery_address_label VARCHAR(30),
  delivery_lat DOUBLE PRECISION,
  delivery_lng DOUBLE PRECISION,
  status VARCHAR(40) NOT NULL DEFAULT 'pending',
  item_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  delivery_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  order_credit_used_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  missing_items_credit_earned NUMERIC(12,2) NOT NULL DEFAULT 0,
  delivery_fee_credit_earned NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_compensation_credit_earned NUMERIC(12,2) NOT NULL DEFAULT 0,
  platform_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  delivery_fee_waived BOOLEAN NOT NULL DEFAULT FALSE,
  delivery_credit_used BOOLEAN NOT NULL DEFAULT FALSE,
  fee_rule_id BIGINT,
  fee_rule_version INTEGER,
  promo_id UUID,
  promo_code TEXT,
  order_hash VARCHAR(64),
  currency VARCHAR(10) NOT NULL DEFAULT 'inr',
  payment_status VARCHAR(40) NOT NULL DEFAULT 'pending',
  payment_method VARCHAR(40),
  cancellation_reason TEXT,
  assigned_driver_uid VARCHAR(128),
  assigned_driver_phone VARCHAR(20),
  assigned_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  delivery_pin VARCHAR(8),
  delivery_pin_generated_at TIMESTAMPTZ,
  delivery_pin_verified_at TIMESTAMPTZ,
  driver_executed_archived_at TIMESTAMPTZ,
  stripe_payment_intent_id VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

UPDATE orders
SET currency = 'inr'
WHERE currency IS NULL
   OR BTRIM(currency) = ''
   OR LOWER(currency) <> 'inr';

CREATE TABLE IF NOT EXISTS fee_rules (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  platform_fee_type VARCHAR(20) NOT NULL DEFAULT 'percentage',
  platform_fee_value NUMERIC(10,4) NOT NULL DEFAULT 0.05,
  min_platform_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
  max_platform_fee NUMERIC(12,2),
  feature_flag_key VARCHAR(80) NOT NULL DEFAULT 'platform_fee_enabled',
  feature_flag_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS delivery_fee_slabs (
  id BIGSERIAL PRIMARY KEY,
  city VARCHAR(120),
  start_time TIME,
  end_time TIME,
  user_type VARCHAR(40),
  min_order_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  max_order_amount NUMERIC(12,2) NOT NULL DEFAULT 999999,
  delivery_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS promo_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percentage', 'flat')),
  discount_value NUMERIC(10,2) NOT NULL,
  max_discount NUMERIC(10,2),
  min_order_amount NUMERIC(10,2),
  usage_limit INT,
  used_count INT NOT NULL DEFAULT 0,
  per_user_limit INT NOT NULL DEFAULT 1,
  city VARCHAR(120),
  user_type VARCHAR(40),
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS promo_usages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_id UUID NOT NULL REFERENCES promo_codes(id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL,
  order_id BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS delivery_credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('earned', 'used')),
  credits INT NOT NULL,
  order_id BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  source TEXT,
  referral_id UUID REFERENCES referrals(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name VARCHAR(200) NOT NULL,
  unit_price NUMERIC(10,2) NOT NULL,
  quantity INTEGER NOT NULL,
  picked_by_driver BOOLEAN,
  picked_marked_at TIMESTAMPTZ,
  line_total NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('earned', 'used')),
  amount NUMERIC(12,2) NOT NULL,
  order_id BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  reference_tx_id TEXT,
  source TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_credit_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'finalized', 'released')) DEFAULT 'pending',
  payment_intent_id VARCHAR(128),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (order_id)
);

CREATE TABLE IF NOT EXISTS user_wallet_balances (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  delivery_credits_balance INT NOT NULL DEFAULT 0,
  order_credits_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id VARCHAR(128) PRIMARY KEY,
  event_type VARCHAR(80) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'processed',
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_addresses (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label VARCHAR(30) NOT NULL DEFAULT 'Home',
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  full_address TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS delivery_address_id BIGINT REFERENCES user_addresses(id) ON DELETE SET NULL;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS delivery_address_text TEXT;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS delivery_address_label VARCHAR(30);

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS delivery_lat DOUBLE PRECISION;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS delivery_lng DOUBLE PRECISION;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS assigned_driver_uid VARCHAR(128);

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS assigned_driver_phone VARCHAR(20);

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS delivery_pin VARCHAR(8);

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS delivery_pin_generated_at TIMESTAMPTZ;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS delivery_pin_verified_at TIMESTAMPTZ;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS driver_executed_archived_at TIMESTAMPTZ;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS platform_fee NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS item_total NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS order_credit_used_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS payment_method VARCHAR(40);

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

ALTER TABLE orders
DROP CONSTRAINT IF EXISTS chk_orders_cancelled_reason;

ALTER TABLE orders
ADD CONSTRAINT chk_orders_cancelled_reason
CHECK (
  status <> 'cancelled'
  OR NULLIF(BTRIM(cancellation_reason), '') IN (
    'unavailable_by_driver',
    'customer_cancelled',
    'ops_cancelled',
    'payment_failed',
    'other'
  )
) NOT VALID;

UPDATE orders
SET cancellation_reason = 'other'
WHERE status = 'cancelled'
  AND (
    NULLIF(BTRIM(cancellation_reason), '') IS NULL
    OR NULLIF(BTRIM(cancellation_reason), '') NOT IN (
      'unavailable_by_driver',
      'customer_cancelled',
      'ops_cancelled',
      'payment_failed',
      'other'
    )
  );

ALTER TABLE orders
VALIDATE CONSTRAINT chk_orders_cancelled_reason;

ALTER TABLE order_credit_reservations
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes');

ALTER TABLE order_credit_transactions
ADD COLUMN IF NOT EXISTS reference_tx_id TEXT;

ALTER TABLE order_credit_transactions
ADD COLUMN IF NOT EXISTS note TEXT;

ALTER TABLE order_credit_transactions
DROP CONSTRAINT IF EXISTS chk_order_credit_manual_adjustment_reference;

ALTER TABLE order_credit_transactions
ADD CONSTRAINT chk_order_credit_manual_adjustment_reference
CHECK (
  source IS NULL
  OR source NOT LIKE 'manual_adjustment_%'
  OR NULLIF(BTRIM(reference_tx_id), '') IS NOT NULL
) NOT VALID;

UPDATE order_credit_transactions
SET reference_tx_id = COALESCE(
  NULLIF(BTRIM(SPLIT_PART(source, ':', 2)), ''),
  id::text
)
WHERE source LIKE 'manual_adjustment_%'
  AND NULLIF(BTRIM(reference_tx_id), '') IS NULL;

ALTER TABLE order_credit_transactions
VALIDATE CONSTRAINT chk_order_credit_manual_adjustment_reference;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS missing_items_credit_earned NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS delivery_fee_credit_earned NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS total_compensation_credit_earned NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS total_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS fee_rule_id BIGINT;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS fee_rule_version INTEGER;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS promo_id UUID;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS promo_code TEXT;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS order_hash VARCHAR(64);

ALTER TABLE orders
DROP CONSTRAINT IF EXISTS orders_fee_rule_id_fkey;

ALTER TABLE orders
ADD CONSTRAINT orders_fee_rule_id_fkey
FOREIGN KEY (fee_rule_id) REFERENCES fee_rules(id) ON DELETE SET NULL;

ALTER TABLE orders
DROP CONSTRAINT IF EXISTS orders_promo_id_fkey;

ALTER TABLE orders
ADD CONSTRAINT orders_promo_id_fkey
FOREIGN KEY (promo_id) REFERENCES promo_codes(id) ON DELETE SET NULL;

UPDATE orders
SET item_total = COALESCE(item_total, COALESCE(subtotal, 0)),
    subtotal = COALESCE(subtotal, COALESCE(item_total, 0)),
    delivery_fee = COALESCE(delivery_fee, 0),
    discount_amount = COALESCE(discount_amount, 0),
    platform_fee = COALESCE(platform_fee, 0),
    delivery_fee_credit_earned = COALESCE(delivery_fee_credit_earned, 0),
    total_compensation_credit_earned = COALESCE(
      total_compensation_credit_earned,
      COALESCE(missing_items_credit_earned, 0) + COALESCE(delivery_fee_credit_earned, 0)
    ),
    total_amount = CASE
      WHEN COALESCE(total_amount, 0) > 0 THEN total_amount
      ELSE COALESCE(COALESCE(item_total, subtotal), 0) + COALESCE(delivery_fee, 0) + COALESCE(platform_fee, 0) - COALESCE(discount_amount, 0)
    END
WHERE item_total IS NULL
   OR delivery_fee IS NULL
   OR discount_amount IS NULL
   OR order_credit_used_amount IS NULL
   OR missing_items_credit_earned IS NULL
   OR delivery_fee_credit_earned IS NULL
   OR total_compensation_credit_earned IS NULL
   OR platform_fee IS NULL
   OR total_amount IS NULL
   OR total_amount = 0;

ALTER TABLE order_items
ADD COLUMN IF NOT EXISTS picked_by_driver BOOLEAN;

ALTER TABLE order_items
ADD COLUMN IF NOT EXISTS picked_marked_at TIMESTAMPTZ;

INSERT INTO delivery_fee_slabs (
  city,
  start_time,
  end_time,
  user_type,
  min_order_amount,
  max_order_amount,
  delivery_fee,
  active
)
SELECT
  NULL,
  NULL,
  NULL,
  NULL,
  0,
  19.99,
  8.00,
  TRUE
WHERE NOT EXISTS (SELECT 1 FROM delivery_fee_slabs);

INSERT INTO delivery_fee_slabs (
  city,
  start_time,
  end_time,
  user_type,
  min_order_amount,
  max_order_amount,
  delivery_fee,
  active
)
SELECT
  NULL,
  NULL,
  NULL,
  NULL,
  20.00,
  999999,
  5.00,
  TRUE
WHERE NOT EXISTS (
  SELECT 1
  FROM delivery_fee_slabs
  WHERE min_order_amount = 20.00
    AND max_order_amount = 999999
    AND delivery_fee = 5.00
);

INSERT INTO fee_rules (
  name,
  platform_fee_type,
  platform_fee_value,
  min_platform_fee,
  max_platform_fee,
  feature_flag_key,
  feature_flag_enabled,
  version,
  is_active
)
SELECT
  'Default Platform Fee',
  'percentage',
  0.05,
  0,
  NULL,
  'platform_fee_enabled',
  TRUE,
  1,
  TRUE
WHERE NOT EXISTS (SELECT 1 FROM fee_rules);

UPDATE orders o
SET delivery_lat = COALESCE(o.delivery_lat, ua.lat),
    delivery_lng = COALESCE(o.delivery_lng, ua.lng)
FROM user_addresses ua
WHERE o.delivery_address_id = ua.id
  AND (o.delivery_lat IS NULL OR o.delivery_lng IS NULL);

INSERT INTO categories (name, slug) VALUES
  ('Vegetables', 'vegetables'),
  ('Rice & Dals', 'rice-dals'),
  ('Dairy', 'dairy'),
  ('Snacks', 'snacks'),
  ('Instant Food', 'instant-food'),
  ('Meat & Fish', 'meat-fish'),
  ('Personal Care', 'personal-care'),
  ('Home Care', 'home-care'),
  ('Utensils', 'utensils')
ON CONFLICT (name) DO NOTHING;

INSERT INTO categories (name, slug)
SELECT DISTINCT TRIM(category), LOWER(REGEXP_REPLACE(TRIM(category), '[^a-zA-Z0-9]+', '-', 'g'))
FROM products
WHERE category IS NOT NULL AND TRIM(category) <> ''
ON CONFLICT (name) DO NOTHING;

UPDATE products p
SET category_id = c.id
FROM categories c
WHERE p.category_id IS NULL
  AND p.category IS NOT NULL
  AND TRIM(p.category) <> ''
  AND LOWER(TRIM(p.category)) = LOWER(c.name);

INSERT INTO product_popularity (product_id, total_qty, last_ordered_at, updated_at)
SELECT
  oi.product_id,
  COALESCE(SUM(oi.quantity), 0)::bigint AS total_qty,
  MAX(o.created_at) AS last_ordered_at,
  NOW()
FROM order_items oi
LEFT JOIN orders o ON o.id = oi.order_id
GROUP BY oi.product_id
ON CONFLICT (product_id) DO UPDATE
SET
  total_qty = EXCLUDED.total_qty,
  last_ordered_at = COALESCE(EXCLUDED.last_ordered_at, product_popularity.last_ordered_at),
  updated_at = NOW();

CREATE INDEX IF NOT EXISTS idx_products_store_active ON products(store_id, is_active);
CREATE INDEX IF NOT EXISTS idx_products_search_vector ON products USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING GIN (LOWER(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_brand_trgm ON products USING GIN (LOWER(COALESCE(brand, '')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_slug_trgm ON products USING GIN (LOWER(COALESCE(slug, '')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_created_at_desc ON products(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_embeddings_updated_at ON product_embeddings(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_popularity_total_qty ON product_popularity(total_qty DESC);
CREATE INDEX IF NOT EXISTS idx_favorite_books_user_sort ON favorite_books(user_firebase_uid, sort_order, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_favorites_book_product_unique
  ON product_favorites(book_id, product_id);
CREATE INDEX IF NOT EXISTS idx_product_favorites_user_uid ON product_favorites(user_firebase_uid);
CREATE INDEX IF NOT EXISTS idx_product_favorites_book_id ON product_favorites(book_id);
CREATE INDEX IF NOT EXISTS idx_categories_active_sort_order ON categories(is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_user_addresses_user_default ON user_addresses(user_id, is_default);
CREATE INDEX IF NOT EXISTS idx_driver_access_phone_active ON driver_access(phone_number, is_active);
CREATE INDEX IF NOT EXISTS idx_orders_assigned_driver_status ON orders(assigned_driver_uid, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_paid_assignable ON orders(payment_status, status, assigned_driver_uid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_driver_executed_archive
  ON orders(assigned_driver_uid, status, driver_executed_archived_at, delivered_at DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_firebase_uid_status_created_at
  ON orders(firebase_uid, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_fee_rule_id ON orders(fee_rule_id);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_fee ON orders(delivery_fee);
CREATE INDEX IF NOT EXISTS idx_orders_promo_code ON orders(promo_code);
CREATE INDEX IF NOT EXISTS idx_fee_rules_active_updated ON fee_rules(is_active, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_fee_slabs_active_amount ON delivery_fee_slabs(active, min_order_amount, max_order_amount);
CREATE INDEX IF NOT EXISTS idx_promo_codes_code_active_dates ON promo_codes(LOWER(code), active, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_promo_codes_usage_active ON promo_codes(active, used_count, usage_limit);
CREATE INDEX IF NOT EXISTS idx_promo_usages_promo_user ON promo_usages(promo_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_usages_order_promo_unique ON promo_usages(order_id, promo_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id_id ON order_items(order_id, id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_picked ON order_items(order_id, picked_by_driver);
CREATE INDEX IF NOT EXISTS idx_order_credit_tx_user_created ON order_credit_transactions(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_credit_tx_order_source_type_unique
  ON order_credit_transactions(order_id, source, type);
DROP INDEX IF EXISTS idx_order_credit_tx_manual_reference_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_credit_tx_manual_reference_per_order_unique
  ON order_credit_transactions(order_id, reference_tx_id)
  WHERE source LIKE 'manual_adjustment_%'
    AND NULLIF(BTRIM(reference_tx_id), '') IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_credit_reservations_user_status
  ON order_credit_reservations(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_credit_reservations_intent_status
  ON order_credit_reservations(payment_intent_id, status);
CREATE INDEX IF NOT EXISTS idx_order_credit_reservations_status_expires
  ON order_credit_reservations(status, expires_at);

CREATE OR REPLACE FUNCTION products_search_vector_update()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', COALESCE(LOWER(NEW.name), '')), 'A') ||
    setweight(to_tsvector('simple', COALESCE(LOWER(NEW.brand), '')), 'B') ||
    setweight(to_tsvector('simple', COALESCE(LOWER(NEW.slug), '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION ensure_orders_cancellation_reason()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'cancelled' AND NULLIF(BTRIM(NEW.cancellation_reason), '') IS NULL THEN
    NEW.cancellation_reason := 'other';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sync_wallet_balance_from_delivery_credit_tx()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_wallet_balances (user_id, delivery_credits_balance, updated_at)
  VALUES (NEW.user_id, COALESCE(NEW.credits, 0), NOW())
  ON CONFLICT (user_id)
  DO UPDATE SET
    delivery_credits_balance =
      COALESCE(user_wallet_balances.delivery_credits_balance, 0) + COALESCE(EXCLUDED.delivery_credits_balance, 0),
    updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION sync_wallet_balance_from_order_credit_tx()
RETURNS TRIGGER AS $$
DECLARE
  order_delta NUMERIC(12,2);
BEGIN
  order_delta := CASE
    WHEN NEW.type = 'earned' THEN COALESCE(NEW.amount, 0)
    WHEN NEW.type = 'used' THEN -COALESCE(NEW.amount, 0)
    ELSE 0
  END;

  INSERT INTO user_wallet_balances (user_id, order_credits_balance, updated_at)
  VALUES (NEW.user_id, order_delta, NOW())
  ON CONFLICT (user_id)
  DO UPDATE SET
    order_credits_balance =
      COALESCE(user_wallet_balances.order_credits_balance, 0) + COALESCE(EXCLUDED.order_credits_balance, 0),
    updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_products_search_vector ON products;
CREATE TRIGGER trg_products_search_vector
BEFORE INSERT OR UPDATE OF name, brand, slug
ON products
FOR EACH ROW
EXECUTE FUNCTION products_search_vector_update();

DROP TRIGGER IF EXISTS trg_orders_cancellation_reason ON orders;
CREATE TRIGGER trg_orders_cancellation_reason
BEFORE INSERT OR UPDATE OF status, cancellation_reason
ON orders
FOR EACH ROW
EXECUTE FUNCTION ensure_orders_cancellation_reason();

DROP TRIGGER IF EXISTS trg_delivery_credit_tx_wallet_balance ON delivery_credit_transactions;
CREATE TRIGGER trg_delivery_credit_tx_wallet_balance
AFTER INSERT ON delivery_credit_transactions
FOR EACH ROW
EXECUTE FUNCTION sync_wallet_balance_from_delivery_credit_tx();

DROP TRIGGER IF EXISTS trg_order_credit_tx_wallet_balance ON order_credit_transactions;
CREATE TRIGGER trg_order_credit_tx_wallet_balance
AFTER INSERT ON order_credit_transactions
FOR EACH ROW
EXECUTE FUNCTION sync_wallet_balance_from_order_credit_tx();

UPDATE products
SET search_vector =
  setweight(to_tsvector('simple', COALESCE(LOWER(name), '')), 'A') ||
  setweight(to_tsvector('simple', COALESCE(LOWER(brand), '')), 'B') ||
  setweight(to_tsvector('simple', COALESCE(LOWER(slug), '')), 'C')
WHERE search_vector IS NULL;
`;

let schemaInitPromise;
function initSchema() {
  if (!autoInitSchema) {
    return Promise.resolve();
  }
  if (!schemaInitPromise) {
    schemaInitPromise = pool.query(schemaSql);
  }
  return schemaInitPromise;
}

let driverOrderColumnsInitPromise;
function ensureDriverOrderColumns() {
  if (!autoInitSchema) {
    return Promise.resolve();
  }
  if (!driverOrderColumnsInitPromise) {
    driverOrderColumnsInitPromise = pool.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS assigned_driver_uid VARCHAR(128);

      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS assigned_driver_phone VARCHAR(20);

      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;

      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS delivery_pin VARCHAR(8);

      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS delivery_pin_generated_at TIMESTAMPTZ;

      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS delivery_pin_verified_at TIMESTAMPTZ;

      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS delivery_lat DOUBLE PRECISION;

      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS delivery_lng DOUBLE PRECISION;

      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS driver_executed_archived_at TIMESTAMPTZ;

      CREATE INDEX IF NOT EXISTS idx_orders_driver_executed_archive
        ON orders(assigned_driver_uid, status, driver_executed_archived_at, delivered_at DESC, updated_at DESC);

      UPDATE orders
      SET delivery_pin = LPAD((FLOOR(RANDOM() * 10000))::int::text, 4, '0'),
          delivery_pin_generated_at = COALESCE(delivery_pin_generated_at, NOW()),
          updated_at = NOW()
      WHERE payment_status = 'paid'
        AND status <> 'delivered'
        AND (delivery_pin IS NULL OR BTRIM(delivery_pin) = '');
    `);
  }
  return driverOrderColumnsInitPromise;
}

let pricingSchemaInitPromise;
function ensurePricingSchema() {
  if (!autoInitSchema) {
    return Promise.resolve();
  }
  if (!pricingSchemaInitPromise) {
    pricingSchemaInitPromise = pool.query(`
      CREATE TABLE IF NOT EXISTS fee_rules (
        id BIGSERIAL PRIMARY KEY,
        name VARCHAR(120) NOT NULL,
        platform_fee_type VARCHAR(20) NOT NULL DEFAULT 'percentage',
        platform_fee_value NUMERIC(10,4) NOT NULL DEFAULT 0.05,
        min_platform_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
        max_platform_fee NUMERIC(12,2),
        feature_flag_key VARCHAR(80) NOT NULL DEFAULT 'platform_fee_enabled',
        feature_flag_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        version INTEGER NOT NULL DEFAULT 1,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS delivery_fee_slabs (
        id BIGSERIAL PRIMARY KEY,
        city VARCHAR(120),
        start_time TIME,
        end_time TIME,
        user_type VARCHAR(40),
        min_order_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        max_order_amount NUMERIC(12,2) NOT NULL DEFAULT 999999,
        delivery_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS promo_codes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code TEXT UNIQUE NOT NULL,
        discount_type TEXT NOT NULL CHECK (discount_type IN ('percentage', 'flat')),
        discount_value NUMERIC(10,2) NOT NULL,
        max_discount NUMERIC(10,2),
        min_order_amount NUMERIC(10,2),
        usage_limit INT,
        used_count INT NOT NULL DEFAULT 0,
        per_user_limit INT NOT NULL DEFAULT 1,
        city VARCHAR(120),
        user_type VARCHAR(40),
        start_date TIMESTAMPTZ,
        end_date TIMESTAMPTZ,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS promo_usages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        promo_id UUID NOT NULL REFERENCES promo_codes(id) ON DELETE RESTRICT,
        user_id TEXT NOT NULL,
        order_id BIGINT REFERENCES orders(id) ON DELETE SET NULL,
        used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS referrals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        referrer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        referred_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('pending', 'completed')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS delivery_credit_transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('earned', 'used')),
        credits INT NOT NULL,
        order_id BIGINT REFERENCES orders(id) ON DELETE SET NULL,
        source TEXT,
        referral_id UUID REFERENCES referrals(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS order_credit_transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('earned', 'used')),
        amount NUMERIC(12,2) NOT NULL,
        order_id BIGINT REFERENCES orders(id) ON DELETE SET NULL,
        reference_tx_id TEXT,
        source TEXT,
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS order_credit_reservations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
        status TEXT NOT NULL CHECK (status IN ('pending', 'finalized', 'released')) DEFAULT 'pending',
        payment_intent_id VARCHAR(128),
        expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes'),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (order_id)
      );

      CREATE TABLE IF NOT EXISTS user_wallet_balances (
        user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        delivery_credits_balance INT NOT NULL DEFAULT 0,
        order_credits_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS stripe_webhook_events (
        event_id VARCHAR(128) PRIMARY KEY,
        event_type VARCHAR(80) NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'processed',
        processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS wallet_sync_events (
        firebase_uid TEXT NOT NULL,
        event_type TEXT NOT NULL DEFAULT 'wallet_snapshot',
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'processing', 'done', 'failed')),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        last_error TEXT,
        available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        processed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (firebase_uid, event_type)
      );

      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS referral_code TEXT;

      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS referred_by BIGINT;

      ALTER TABLE users
      DROP CONSTRAINT IF EXISTS users_referred_by_fkey;

      ALTER TABLE users
      ADD CONSTRAINT users_referred_by_fkey
      FOREIGN KEY (referred_by) REFERENCES users(id) ON DELETE SET NULL;

      ALTER TABLE categories
      ADD COLUMN IF NOT EXISTS image_url TEXT;

      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS platform_fee NUMERIC(12,2) NOT NULL DEFAULT 0;

      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS item_total NUMERIC(12,2) NOT NULL DEFAULT 0;

      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC(12,2) NOT NULL DEFAULT 0;

      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0;

      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS order_credit_used_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS payment_method VARCHAR(40);

      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

      ALTER TABLE orders
      DROP CONSTRAINT IF EXISTS chk_orders_cancelled_reason;

      ALTER TABLE orders
      ADD CONSTRAINT chk_orders_cancelled_reason
      CHECK (
        status <> 'cancelled'
        OR NULLIF(BTRIM(cancellation_reason), '') IN (
          'unavailable_by_driver',
          'customer_cancelled',
          'ops_cancelled',
          'payment_failed',
          'other'
        )
      ) NOT VALID;

      UPDATE orders
      SET cancellation_reason = 'other'
      WHERE status = 'cancelled'
        AND (
          NULLIF(BTRIM(cancellation_reason), '') IS NULL
          OR NULLIF(BTRIM(cancellation_reason), '') NOT IN (
            'unavailable_by_driver',
            'customer_cancelled',
            'ops_cancelled',
            'payment_failed',
            'other'
          )
        );

      ALTER TABLE orders
      VALIDATE CONSTRAINT chk_orders_cancelled_reason;

      ALTER TABLE order_credit_reservations
      ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes');

      INSERT INTO user_wallet_balances (
        user_id,
        delivery_credits_balance,
        order_credits_balance,
        updated_at
      )
      SELECT
        u.id,
        COALESCE(d.delivery_balance, 0)::int AS delivery_credits_balance,
        COALESCE(o.order_balance, 0)::numeric(12,2) AS order_credits_balance,
        NOW()
      FROM users u
      LEFT JOIN (
        SELECT user_id, COALESCE(SUM(credits), 0)::int AS delivery_balance
        FROM delivery_credit_transactions
        GROUP BY user_id
      ) d ON d.user_id = u.id
      LEFT JOIN (
        SELECT
          user_id,
          COALESCE(SUM(
            CASE
              WHEN type = 'earned' THEN amount
              WHEN type = 'used' THEN -amount
              ELSE 0
            END
          ), 0)::numeric(12,2) AS order_balance
        FROM order_credit_transactions
        GROUP BY user_id
      ) o ON o.user_id = u.id
      WHERE NOT EXISTS (SELECT 1 FROM user_wallet_balances)
      ON CONFLICT (user_id) DO NOTHING;

      ALTER TABLE order_credit_transactions
      ADD COLUMN IF NOT EXISTS reference_tx_id TEXT;

      ALTER TABLE order_credit_transactions
      ADD COLUMN IF NOT EXISTS note TEXT;

      ALTER TABLE order_credit_transactions
      DROP CONSTRAINT IF EXISTS chk_order_credit_manual_adjustment_reference;

      ALTER TABLE order_credit_transactions
      ADD CONSTRAINT chk_order_credit_manual_adjustment_reference
      CHECK (
        source IS NULL
        OR source NOT LIKE 'manual_adjustment_%'
        OR NULLIF(BTRIM(reference_tx_id), '') IS NOT NULL
      ) NOT VALID;

      UPDATE order_credit_transactions
      SET reference_tx_id = COALESCE(
        NULLIF(BTRIM(SPLIT_PART(source, ':', 2)), ''),
        id::text
      )
      WHERE source LIKE 'manual_adjustment_%'
        AND NULLIF(BTRIM(reference_tx_id), '') IS NULL;

      ALTER TABLE order_credit_transactions
      VALIDATE CONSTRAINT chk_order_credit_manual_adjustment_reference;

      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS missing_items_credit_earned NUMERIC(12,2) NOT NULL DEFAULT 0;

      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS delivery_fee_credit_earned NUMERIC(12,2) NOT NULL DEFAULT 0;

      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS total_compensation_credit_earned NUMERIC(12,2) NOT NULL DEFAULT 0;

      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS total_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS fee_rule_id BIGINT;

      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS fee_rule_version INTEGER;

      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS promo_id UUID;

      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS promo_code TEXT;

      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS order_hash VARCHAR(64);

      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS delivery_fee_waived BOOLEAN NOT NULL DEFAULT FALSE;

      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS delivery_credit_used BOOLEAN NOT NULL DEFAULT FALSE;

      ALTER TABLE orders
      DROP CONSTRAINT IF EXISTS orders_fee_rule_id_fkey;

      ALTER TABLE orders
      ADD CONSTRAINT orders_fee_rule_id_fkey
      FOREIGN KEY (fee_rule_id) REFERENCES fee_rules(id) ON DELETE SET NULL;

      ALTER TABLE orders
      DROP CONSTRAINT IF EXISTS orders_promo_id_fkey;

      ALTER TABLE orders
      ADD CONSTRAINT orders_promo_id_fkey
      FOREIGN KEY (promo_id) REFERENCES promo_codes(id) ON DELETE SET NULL;

      UPDATE orders
      SET item_total = COALESCE(item_total, COALESCE(subtotal, 0)),
          subtotal = COALESCE(subtotal, COALESCE(item_total, 0)),
          delivery_fee = COALESCE(delivery_fee, 0),
          discount_amount = COALESCE(discount_amount, 0),
          platform_fee = COALESCE(platform_fee, 0),
          delivery_fee_credit_earned = COALESCE(delivery_fee_credit_earned, 0),
          total_compensation_credit_earned = COALESCE(
            total_compensation_credit_earned,
            COALESCE(missing_items_credit_earned, 0) + COALESCE(delivery_fee_credit_earned, 0)
          ),
          total_amount = CASE
            WHEN COALESCE(total_amount, 0) > 0 THEN total_amount
            ELSE COALESCE(COALESCE(item_total, subtotal), 0) + COALESCE(delivery_fee, 0) + COALESCE(platform_fee, 0) - COALESCE(discount_amount, 0)
          END
      WHERE item_total IS NULL
         OR delivery_fee IS NULL
         OR discount_amount IS NULL
         OR order_credit_used_amount IS NULL
         OR missing_items_credit_earned IS NULL
         OR delivery_fee_credit_earned IS NULL
         OR total_compensation_credit_earned IS NULL
         OR platform_fee IS NULL
         OR total_amount IS NULL
         OR total_amount = 0;

      ALTER TABLE order_items
      ADD COLUMN IF NOT EXISTS picked_by_driver BOOLEAN;

      ALTER TABLE order_items
      ADD COLUMN IF NOT EXISTS picked_marked_at TIMESTAMPTZ;

      INSERT INTO fee_rules (
        name,
        platform_fee_type,
        platform_fee_value,
        min_platform_fee,
        max_platform_fee,
        feature_flag_key,
        feature_flag_enabled,
        version,
        is_active
      )
      SELECT
        'Default Platform Fee',
        'percentage',
        0.05,
        0,
        NULL,
        'platform_fee_enabled',
        TRUE,
        1,
        TRUE
      WHERE NOT EXISTS (SELECT 1 FROM fee_rules);

      INSERT INTO delivery_fee_slabs (
        city,
        start_time,
        end_time,
        user_type,
        min_order_amount,
        max_order_amount,
        delivery_fee,
        active
      )
      SELECT
        NULL,
        NULL,
        NULL,
        NULL,
        0,
        19.99,
        8.00,
        TRUE
      WHERE NOT EXISTS (SELECT 1 FROM delivery_fee_slabs);

      INSERT INTO delivery_fee_slabs (
        city,
        start_time,
        end_time,
        user_type,
        min_order_amount,
        max_order_amount,
        delivery_fee,
        active
      )
      SELECT
        NULL,
        NULL,
        NULL,
        NULL,
        20.00,
        999999,
        5.00,
        TRUE
      WHERE NOT EXISTS (
        SELECT 1
        FROM delivery_fee_slabs
        WHERE min_order_amount = 20.00
          AND max_order_amount = 999999
          AND delivery_fee = 5.00
      );

      CREATE OR REPLACE FUNCTION sync_wallet_balance_from_delivery_credit_tx()
      RETURNS TRIGGER AS $$
      BEGIN
        INSERT INTO user_wallet_balances (user_id, delivery_credits_balance, updated_at)
        VALUES (NEW.user_id, COALESCE(NEW.credits, 0), NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET
          delivery_credits_balance =
            COALESCE(user_wallet_balances.delivery_credits_balance, 0) + COALESCE(EXCLUDED.delivery_credits_balance, 0),
          updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      CREATE OR REPLACE FUNCTION sync_wallet_balance_from_order_credit_tx()
      RETURNS TRIGGER AS $$
      DECLARE
        order_delta NUMERIC(12,2);
      BEGIN
        order_delta := CASE
          WHEN NEW.type = 'earned' THEN COALESCE(NEW.amount, 0)
          WHEN NEW.type = 'used' THEN -COALESCE(NEW.amount, 0)
          ELSE 0
        END;

        INSERT INTO user_wallet_balances (user_id, order_credits_balance, updated_at)
        VALUES (NEW.user_id, order_delta, NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET
          order_credits_balance =
            COALESCE(user_wallet_balances.order_credits_balance, 0) + COALESCE(EXCLUDED.order_credits_balance, 0),
          updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_delivery_credit_tx_wallet_balance ON delivery_credit_transactions;
      CREATE TRIGGER trg_delivery_credit_tx_wallet_balance
        AFTER INSERT ON delivery_credit_transactions
        FOR EACH ROW
        EXECUTE FUNCTION sync_wallet_balance_from_delivery_credit_tx();

      DROP TRIGGER IF EXISTS trg_order_credit_tx_wallet_balance ON order_credit_transactions;
      CREATE TRIGGER trg_order_credit_tx_wallet_balance
        AFTER INSERT ON order_credit_transactions
        FOR EACH ROW
        EXECUTE FUNCTION sync_wallet_balance_from_order_credit_tx();

      CREATE INDEX IF NOT EXISTS idx_orders_fee_rule_id ON orders(fee_rule_id);
      CREATE INDEX IF NOT EXISTS idx_orders_firebase_uid_status_created_at
        ON orders(firebase_uid, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_orders_delivery_fee ON orders(delivery_fee);
      CREATE INDEX IF NOT EXISTS idx_orders_promo_code ON orders(promo_code);
      CREATE INDEX IF NOT EXISTS idx_fee_rules_active_updated ON fee_rules(is_active, updated_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_delivery_fee_slabs_active_amount ON delivery_fee_slabs(active, min_order_amount, max_order_amount);
      CREATE INDEX IF NOT EXISTS idx_promo_codes_code_active_dates ON promo_codes(LOWER(code), active, start_date, end_date);
      CREATE INDEX IF NOT EXISTS idx_promo_codes_usage_active ON promo_codes(active, used_count, usage_limit);
      CREATE INDEX IF NOT EXISTS idx_promo_usages_promo_user ON promo_usages(promo_id, user_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_usages_order_promo_unique ON promo_usages(order_id, promo_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code_unique ON users(LOWER(referral_code));
      CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_referred_user_unique ON referrals(referred_user_id);
      CREATE INDEX IF NOT EXISTS idx_referrals_referrer_status ON referrals(referrer_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_delivery_credit_tx_user_created ON delivery_credit_transactions(user_id, created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_credit_tx_order_user_type_unique ON delivery_credit_transactions(order_id, user_id, type);
      CREATE INDEX IF NOT EXISTS idx_order_items_order_picked ON order_items(order_id, picked_by_driver);
      CREATE INDEX IF NOT EXISTS idx_order_items_order_id_id ON order_items(order_id, id);
      CREATE INDEX IF NOT EXISTS idx_order_credit_tx_user_created ON order_credit_transactions(user_id, created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_order_credit_tx_order_source_type_unique ON order_credit_transactions(order_id, source, type);
      DROP INDEX IF EXISTS idx_order_credit_tx_manual_reference_unique;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_order_credit_tx_manual_reference_per_order_unique
        ON order_credit_transactions(order_id, reference_tx_id)
        WHERE source LIKE 'manual_adjustment_%'
          AND NULLIF(BTRIM(reference_tx_id), '') IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_order_credit_reservations_user_status
        ON order_credit_reservations(user_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_order_credit_reservations_intent_status
        ON order_credit_reservations(payment_intent_id, status);
      CREATE INDEX IF NOT EXISTS idx_order_credit_reservations_status_expires
        ON order_credit_reservations(status, expires_at);
      CREATE INDEX IF NOT EXISTS idx_wallet_sync_events_status_available
        ON wallet_sync_events(status, available_at, updated_at);
    `);
  }
  return pricingSchemaInitPromise;
}

if (autoInitSchema) {
  app.use(async (_req, _res, next) => {
    try {
      await initSchema();
      next();
    } catch (error) {
      next(error);
    }
  });
}

app.use(async (_req, _res, next) => {
  try {
    await maybeDrainWalletSyncOutboxOnRequest();
  } catch (_error) {}
  next();
});

function toSlug(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 150);
}

function safeNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeFeeRuleRow(row) {
  if (!row) return null;
  const maxPlatformFeeRaw = Number(row.max_platform_fee);
  return {
    id: Number(row.id),
    name: String(row.name || '').trim(),
    platform_fee_type: coerceFeeType(row.platform_fee_type),
    platform_fee_value: Number(row.platform_fee_value) || 0,
    min_platform_fee: Math.max(0, Number(row.min_platform_fee) || 0),
    max_platform_fee:
      Number.isFinite(maxPlatformFeeRaw) && maxPlatformFeeRaw >= 0
        ? roundCurrencyAmount(maxPlatformFeeRaw)
        : null,
    feature_flag_key: String(row.feature_flag_key || 'platform_fee_enabled').trim(),
    feature_flag_enabled: row.feature_flag_enabled === true,
    version: Number(row.version) || 1,
    is_active: row.is_active === true,
    metadata:
      row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? row.metadata
        : {},
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeDeliveryFeeSlabRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    city: row.city ? String(row.city).trim() : null,
    start_time: row.start_time ? String(row.start_time) : null,
    end_time: row.end_time ? String(row.end_time) : null,
    user_type: row.user_type ? String(row.user_type).trim().toLowerCase() : null,
    min_order_amount: Math.max(0, roundCurrencyAmount(Number(row.min_order_amount) || 0)),
    max_order_amount: Math.max(0, roundCurrencyAmount(Number(row.max_order_amount) || 0)),
    delivery_fee: Math.max(0, roundCurrencyAmount(Number(row.delivery_fee) || 0)),
    active: row.active === true,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizePromoRow(row) {
  if (!row) return null;
  const usageLimitRaw = Number(row.usage_limit);
  const maxDiscountRaw = Number(row.max_discount);
  const minOrderAmountRaw = Number(row.min_order_amount);
  return {
    id: String(row.id || '').trim(),
    code: normalizePromoCodeForStorage(row.code),
    discount_type: coercePromoDiscountType(row.discount_type),
    discount_value: Math.max(0, roundCurrencyAmount(Number(row.discount_value) || 0)),
    max_discount:
      Number.isFinite(maxDiscountRaw) && maxDiscountRaw >= 0
        ? roundCurrencyAmount(maxDiscountRaw)
        : null,
    min_order_amount:
      Number.isFinite(minOrderAmountRaw) && minOrderAmountRaw >= 0
        ? roundCurrencyAmount(minOrderAmountRaw)
        : 0,
    usage_limit:
      Number.isFinite(usageLimitRaw) && usageLimitRaw > 0
        ? Math.trunc(usageLimitRaw)
        : null,
    used_count: Math.max(0, Math.trunc(Number(row.used_count) || 0)),
    per_user_limit: Math.max(0, Math.trunc(Number(row.per_user_limit) || 1)),
    city: row.city ? String(row.city).trim() : null,
    user_type: row.user_type ? String(row.user_type).trim().toLowerCase() : null,
    start_date: row.start_date || null,
    end_date: row.end_date || null,
    active: row.active === true,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const REDIS_REST_URL = (process.env.UPSTASH_REDIS_REST_URL || '').trim();
const REDIS_REST_TOKEN = (process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
const PRODUCTS_CACHE_GLOBAL_VERSION_KEY = 'products:version:global';
const PRODUCTS_CACHE_MIN_LIMIT = 20;
const PRODUCTS_CACHE_MAX_LIMIT = 30;
const PRODUCTS_CACHE_DEFAULT_LIMIT = 24;
const PRODUCTS_CACHE_SHAPE_VERSION = '5';
const PRODUCTS_CACHE_TTL_SECONDS = Math.min(
  120,
  Math.max(60, Number.parseInt(process.env.UPSTASH_PRODUCTS_TTL_SECONDS || '90', 10) || 90),
);
const PRODUCT_SEARCH_SEMANTIC_ENABLED = parseBooleanEnv(
  process.env.PRODUCT_SEARCH_SEMANTIC_ENABLED,
  true,
);
const PRODUCT_SEARCH_SEMANTIC_MIN_QUERY_LENGTH = Math.max(
  2,
  parseInteger(process.env.PRODUCT_SEARCH_SEMANTIC_MIN_QUERY_LENGTH, 5),
);
const PRODUCT_SEARCH_TRIGRAM_THRESHOLD = Math.min(
  0.5,
  Math.max(0.1, safeNum(process.env.PRODUCT_SEARCH_TRIGRAM_THRESHOLD, 0.22)),
);
const PRODUCT_SEARCH_VECTOR_MIN_SIMILARITY = Math.min(
  0.95,
  Math.max(0.05, safeNum(process.env.PRODUCT_SEARCH_VECTOR_MIN_SIMILARITY, 0.18)),
);
const PRODUCT_SEARCH_TEXT_WEIGHT = Math.max(
  0,
  safeNum(process.env.PRODUCT_SEARCH_TEXT_WEIGHT, 0.5),
);
const PRODUCT_SEARCH_VECTOR_WEIGHT = Math.max(
  0,
  safeNum(process.env.PRODUCT_SEARCH_VECTOR_WEIGHT, 0.3),
);
const PRODUCT_SEARCH_POPULARITY_WEIGHT = Math.max(
  0,
  safeNum(process.env.PRODUCT_SEARCH_POPULARITY_WEIGHT, 0.1),
);
const PRODUCT_SEARCH_STOCK_WEIGHT = Math.max(
  0,
  safeNum(process.env.PRODUCT_SEARCH_STOCK_WEIGHT, 0.1),
);
const PRODUCT_SEARCH_WEIGHT_SUM = [
  PRODUCT_SEARCH_TEXT_WEIGHT,
  PRODUCT_SEARCH_VECTOR_WEIGHT,
  PRODUCT_SEARCH_POPULARITY_WEIGHT,
  PRODUCT_SEARCH_STOCK_WEIGHT,
].reduce((sum, value) => sum + value, 0);
const NORMALIZED_PRODUCT_SEARCH_TEXT_WEIGHT =
  PRODUCT_SEARCH_WEIGHT_SUM > 0
    ? PRODUCT_SEARCH_TEXT_WEIGHT / PRODUCT_SEARCH_WEIGHT_SUM
    : 0.5;
const NORMALIZED_PRODUCT_SEARCH_VECTOR_WEIGHT =
  PRODUCT_SEARCH_WEIGHT_SUM > 0
    ? PRODUCT_SEARCH_VECTOR_WEIGHT / PRODUCT_SEARCH_WEIGHT_SUM
    : 0.3;
const NORMALIZED_PRODUCT_SEARCH_POPULARITY_WEIGHT =
  PRODUCT_SEARCH_WEIGHT_SUM > 0
    ? PRODUCT_SEARCH_POPULARITY_WEIGHT / PRODUCT_SEARCH_WEIGHT_SUM
    : 0.1;
const NORMALIZED_PRODUCT_SEARCH_STOCK_WEIGHT =
  PRODUCT_SEARCH_WEIGHT_SUM > 0
    ? PRODUCT_SEARCH_STOCK_WEIGHT / PRODUCT_SEARCH_WEIGHT_SUM
    : 0.1;
const CATEGORIES_CACHE_TTL_SECONDS = Math.min(
  900,
  Math.max(300, Number.parseInt(process.env.UPSTASH_CATEGORIES_TTL_SECONDS || '600', 10) || 600),
);
const ORDERS_CACHE_SHAPE_VERSION = '4';
const ORDERS_CACHE_TTL_SECONDS = Math.min(
  120,
  Math.max(20, Number.parseInt(process.env.UPSTASH_ORDERS_TTL_SECONDS || '30', 10) || 30),
);
const DOTBOT_MESSAGE_MAX_WORDS = clamp(
  parseInteger(process.env.DOTBOT_MESSAGE_MAX_WORDS, 300),
  30,
  1000,
);
const DOTBOT_RATE_LIMIT_WINDOW_SECONDS = clamp(
  parseInteger(process.env.DOTBOT_RATE_LIMIT_WINDOW_SECONDS, 60),
  10,
  3600,
);
const DOTBOT_RATE_LIMIT_MESSAGE_LIMIT = clamp(
  parseInteger(process.env.DOTBOT_RATE_LIMIT_MESSAGE_LIMIT, 20),
  1,
  500,
);
const DOTBOT_RATE_LIMIT_TRANSCRIBE_LIMIT = clamp(
  parseInteger(process.env.DOTBOT_RATE_LIMIT_TRANSCRIBE_LIMIT, 10),
  1,
  300,
);
const DOTBOT_RATE_LIMIT_TTS_LIMIT = clamp(
  parseInteger(process.env.DOTBOT_RATE_LIMIT_TTS_LIMIT, 15),
  1,
  300,
);

const DRIVER_EXECUTED_VISIBLE_LIMIT = 50;
const FIRESTORE_BATCH_GET_MAX = 100;

const {
  countWords,
  createDotbotRateLimitMiddleware,
  encodeCursor,
  decodeCursor,
  cacheSegment,
  getJsonCache,
  setJsonCache,
  getProductsCacheVersion,
  bumpProductsCacheVersion,
  getOrdersCacheVersion,
  bumpOrdersCacheVersion,
} = createCacheRuntime({
  fetchImpl: fetch,
  redisRestUrl: REDIS_REST_URL,
  redisRestToken: REDIS_REST_TOKEN,
  productsCacheGlobalVersionKey: PRODUCTS_CACHE_GLOBAL_VERSION_KEY,
  productsCacheTtlSeconds: PRODUCTS_CACHE_TTL_SECONDS,
  dotbotRateLimitWindowSeconds: DOTBOT_RATE_LIMIT_WINDOW_SECONDS,
});

const { hydrateDriverOrderCustomerNames } = createUserDisplayNameUtils({
  normalizeDisplayName,
  getFirebaseAdminFirestore,
  firestoreBatchGetMax: FIRESTORE_BATCH_GET_MAX,
});

const { resolveUserRole, archiveDeliveredOrdersForDriver } = createDriverOrderUtils({
  pool,
  normalizePhoneNumber,
  parseInteger,
  clamp,
  defaultVisibleLimit: DRIVER_EXECUTED_VISIBLE_LIMIT,
});

function asCheckoutError(status, message, extra = {}) {
  const error = new Error(message);
  error.httpStatus = status;
  error.payload = { ok: false, message, ...extra };
  return error;
}

const {
  buildReferralCodeCandidate,
  ensureUserReferralCode,
  resolveUserIdFromIdentity,
  isAddressServiceable,
  ensureUserRow,
  resolveCheckoutAddress,
} = createUserIdentityUtils({
  normalizeReferralCode,
  randomUUID,
  parseNullableNumber,
  haversineDistanceKm,
  asCheckoutError,
});

const { maybeCompleteReferralRewardForFirstPaidOrder } = createReferralRewardUtils();

const { normalizeCheckoutItems, calculateItemTotalFromItems } = createCheckoutItemUtils({
  asCheckoutError,
  roundCurrencyAmount,
});

const {
  getActivePlatformFeeRule,
  calculatePlatformFee,
  getDeliveryCreditBalance,
  getOrderCreditBalance,
  getPendingOrderCreditReservationAmount,
  getAvailableOrderCreditBalance,
  isPromoWithinDateWindow,
  findPromoByCode,
  computePromoDiscount,
  calculateDeliveryFee,
  calculatePricingBreakdown,
  assertNoActiveDeliverySlabOverlap,
} = createPricingUtils({
  resolveUserIdFromIdentity,
  normalizePromoCode,
  normalizeDeliveryFeeSlabRow,
  coerceFeeType,
  roundCurrencyAmount,
  parseSqlTimeOrNull,
  timeInWindow,
  toTimeSegments,
  segmentsOverlap,
  amountRangesOverlap,
  optionalDimensionOverlaps,
});

async function createPendingOrderWithStockLock(
  client,
  { firebaseUid, rawItems, addressId, promoCode = null },
) {
  if (!createPendingOrderWithStockLock.schemaReadyPromise) {
    createPendingOrderWithStockLock.schemaReadyPromise = Promise.all([
      ensureDriverOrderColumns(),
      ensurePricingSchema(),
    ]).catch((error) => {
      createPendingOrderWithStockLock.schemaReadyPromise = null;
      throw error;
    });
  }
  await createPendingOrderWithStockLock.schemaReadyPromise;
  const byProduct = normalizeCheckoutItems(rawItems);
  const { address } = await resolveCheckoutAddress(client, {
    firebaseUid,
    requestedAddressId: addressId,
  });
  let subtotal = 0;
  const checkoutItems = [];
  const orderRes = await client.query(
    `
    INSERT INTO orders (
      firebase_uid,
      delivery_address_id,
      delivery_address_text,
      delivery_address_label,
      delivery_lat,
      delivery_lng,
      status,
      payment_status,
      item_total,
      subtotal,
      delivery_fee,
      discount_amount,
      order_credit_used_amount,
      platform_fee,
      total_amount,
      delivery_fee_waived,
      delivery_credit_used,
      fee_rule_id,
      fee_rule_version,
      promo_id,
      promo_code
    )
    VALUES ($1, $2, $3, $4, $5, $6, 'pending', 'pending', 0, 0, 0, 0, 0, 0, 0, FALSE, FALSE, NULL, NULL, NULL, NULL)
    RETURNING id, status, payment_status, currency, created_at
    `,
    [
      firebaseUid,
      Number(address.id),
      String(address.full_address || '').trim(),
      String(address.label || '').trim() || 'Home',
      parseNullableNumber(address.lat),
      parseNullableNumber(address.lng),
    ],
  );
  const order = orderRes.rows[0];
  const orderId = Number(order.id);
  const requestedProductIds = [...byProduct.keys()];
  const requestedQuantities = requestedProductIds.map((productId) => byProduct.get(productId));
  const productsRes = await client.query(
    `
    SELECT id, name, is_active, stock_qty, price_sale
    FROM products
    WHERE id = ANY($1::bigint[])
    FOR UPDATE
    `,
    [requestedProductIds],
  );
  const productById = new Map();
  for (const row of productsRes.rows) {
    productById.set(Number(row.id), row);
  }

  const itemProductIds = [];
  const itemNames = [];
  const itemUnitPrices = [];
  const itemQuantities = [];
  const itemLineTotals = [];

  for (const productId of requestedProductIds) {
    const quantity = Number(byProduct.get(productId) || 0);
    const product = productById.get(productId);
    if (!product) {
      throw asCheckoutError(404, `Product ${productId} not found`);
    }
    if (!product.is_active) {
      throw asCheckoutError(409, `${product.name} is currently unavailable`, { productId });
    }

    const available = Number(product.stock_qty);
    if (available < quantity) {
      throw asCheckoutError(409, `Insufficient stock for ${product.name}`, {
        productId,
        requested: quantity,
        available,
      });
    }

    const unitPrice = Number(product.price_sale);
    const lineTotal = unitPrice * quantity;
    subtotal += lineTotal;

    itemProductIds.push(productId);
    itemNames.push(String(product.name || '').trim());
    itemUnitPrices.push(unitPrice);
    itemQuantities.push(quantity);
    itemLineTotals.push(lineTotal);

    checkoutItems.push({
      product_id: productId,
      name: product.name,
      quantity,
      unit_price: unitPrice,
      line_total: lineTotal,
    });
  }

  await client.query(
    `
    WITH requested AS (
      SELECT * FROM UNNEST($1::bigint[], $2::int[]) AS t(product_id, quantity)
    )
    UPDATE products p
    SET stock_qty = p.stock_qty - requested.quantity
    FROM requested
    WHERE p.id = requested.product_id
    `,
    [requestedProductIds, requestedQuantities],
  );

  await client.query(
    `
    INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, line_total)
    SELECT
      $1::bigint,
      item.product_id,
      item.product_name,
      item.unit_price,
      item.quantity,
      item.line_total
    FROM UNNEST(
      $2::bigint[],
      $3::text[],
      $4::numeric[],
      $5::int[],
      $6::numeric[]
    ) AS item(product_id, product_name, unit_price, quantity, line_total)
    `,
    [orderId, itemProductIds, itemNames, itemUnitPrices, itemQuantities, itemLineTotals],
  );

  await client.query(
    `
    INSERT INTO product_popularity (product_id, total_qty, last_ordered_at, updated_at)
    SELECT item.product_id, item.quantity, NOW(), NOW()
    FROM UNNEST($1::bigint[], $2::int[]) AS item(product_id, quantity)
    ON CONFLICT (product_id)
    DO UPDATE SET
      total_qty = product_popularity.total_qty + EXCLUDED.total_qty,
      last_ordered_at = NOW(),
      updated_at = NOW()
    `,
    [requestedProductIds, requestedQuantities],
  );

  let pricing;
  try {
    pricing = await calculatePricingBreakdown({
      client,
      userId: firebaseUid,
      itemTotal: subtotal,
      promoCode,
    });
  } catch (error) {
    throw asCheckoutError(400, error?.message || 'Failed to apply promo');
  }
  const orderHash = generateOrderIntegrityHash({
    items: checkoutItems,
    totalAmount: pricing.totalAmount,
    currency: order.currency || PLATFORM_CURRENCY,
  });

  await client.query(
    `
    UPDATE orders
    SET item_total = $2,
        subtotal = $3,
        delivery_fee = $4,
        discount_amount = $5,
        order_credit_used_amount = $6,
        platform_fee = $7,
        total_amount = $8,
        delivery_fee_waived = $9,
        delivery_credit_used = $10,
        fee_rule_id = $11,
        fee_rule_version = $12,
        promo_id = $13,
        promo_code = $14,
        order_hash = $15,
        updated_at = NOW()
    WHERE id = $1
    `,
    [
      orderId,
      pricing.itemTotal,
      pricing.subtotal,
      pricing.deliveryFee,
      pricing.discountAmount,
      pricing.orderCreditUsedAmount,
      pricing.platformFee,
      pricing.totalAmount,
      pricing.deliveryFeeWaived,
      pricing.deliveryCreditUsed,
      pricing.feeRuleId,
      pricing.feeRuleVersion,
      pricing.promoId,
      pricing.promoCode,
      orderHash,
    ],
  );

  return {
    orderId,
    itemTotal: pricing.itemTotal,
    subtotal: pricing.subtotal,
    deliveryFee: pricing.deliveryFee,
    discountAmount: pricing.discountAmount,
    orderCreditUsedAmount: pricing.orderCreditUsedAmount,
    platformFee: pricing.platformFee,
    totalAmount: pricing.totalAmount,
    deliveryFeeSlabId: pricing.deliveryFeeSlabId,
    deliveryFeeWaived: pricing.deliveryFeeWaived,
    deliveryCreditUsed: pricing.deliveryCreditUsed,
    promoId: pricing.promoId,
    promoCode: pricing.promoCode,
    feeRuleId: pricing.feeRuleId,
    feeRuleVersion: pricing.feeRuleVersion,
    order,
    checkoutItems,
  };
}

async function recalculatePendingOrderPricing(client, { orderId, firebaseUid, promoCode = null }) {
  const orderRes = await client.query(
    `
    SELECT
      id,
      firebase_uid,
      status,
      payment_status,
      promo_code,
      currency
    FROM orders
    WHERE id = $1
      AND firebase_uid = $2
    FOR UPDATE
    `,
    [orderId, firebaseUid],
  );
  if (orderRes.rowCount === 0) {
    throw asCheckoutError(404, 'Order not found for this user');
  }

  const order = orderRes.rows[0];
  const paymentStatus = String(order.payment_status || '').trim().toLowerCase();
  if (paymentStatus === 'paid') {
    throw asCheckoutError(409, 'Order is already paid');
  }

  const itemsRes = await client.query(
    `
    SELECT
      product_id,
      quantity,
      unit_price,
      line_total
    FROM order_items
    WHERE order_id = $1
    ORDER BY product_id ASC, id ASC
    `,
    [orderId],
  );
  const itemTotal = roundCurrencyAmount(
    itemsRes.rows.reduce((sum, row) => sum + Number(row.line_total || 0), 0),
  );
  if (itemTotal <= 0) {
    throw asCheckoutError(400, 'Invalid order amount');
  }

  const effectivePromoCode = normalizePromoCode(
    promoCode || order.promo_code || null,
  );
  let pricing;
  try {
    pricing = await calculatePricingBreakdown({
      client,
      userId: firebaseUid,
      orderId,
      itemTotal,
      promoCode: effectivePromoCode,
    });
  } catch (error) {
    throw asCheckoutError(400, error?.message || 'Failed to apply promo');
  }
  const orderHash = generateOrderIntegrityHash({
    items: itemsRes.rows,
    totalAmount: pricing.totalAmount,
    currency: order.currency || PLATFORM_CURRENCY,
  });

  await client.query(
    `
    UPDATE orders
    SET item_total = $2,
        subtotal = $3,
        delivery_fee = $4,
        discount_amount = $5,
        order_credit_used_amount = $6,
        platform_fee = $7,
        total_amount = $8,
        delivery_fee_waived = $9,
        delivery_credit_used = $10,
        fee_rule_id = $11,
        fee_rule_version = $12,
        promo_id = $13,
        promo_code = $14,
        order_hash = $15,
        updated_at = NOW()
    WHERE id = $1
    `,
    [
      orderId,
      pricing.itemTotal,
      pricing.subtotal,
      pricing.deliveryFee,
      pricing.discountAmount,
      pricing.orderCreditUsedAmount,
      pricing.platformFee,
      pricing.totalAmount,
      pricing.deliveryFeeWaived,
      pricing.deliveryCreditUsed,
      pricing.feeRuleId,
      pricing.feeRuleVersion,
      pricing.promoId,
      pricing.promoCode,
      orderHash,
    ],
  );

  return pricing;
}

async function resolveCategory(client, { categoryId, categoryName }) {
  const trimmedName = String(categoryName || '').trim();
  const parsedId = Number(categoryId);

  if (Number.isFinite(parsedId)) {
    const byId = await client.query(
      `SELECT id, name FROM categories WHERE id = $1 AND is_active = TRUE`,
      [parsedId],
    );
    if (byId.rowCount === 0) {
      throw new Error('Selected category does not exist');
    }
    return byId.rows[0];
  }

  if (!trimmedName) {
    return null;
  }

  const byName = await client.query(
    `SELECT id, name FROM categories WHERE LOWER(name) = LOWER($1) AND is_active = TRUE`,
    [trimmedName],
  );
  if (byName.rowCount === 0) {
    throw new Error('Selected category does not exist');
  }
  return byName.rows[0];
}

async function getProductById(productId) {
  const productRes = await pool.query(
    `
    SELECT
      p.*,
      COALESCE(c.name, p.category) AS category,
      CASE
        WHEN p.price_mrp > 0 THEN ROUND(((p.price_mrp - p.price_sale) / p.price_mrp) * 100, 2)
        ELSE 0
      END AS discount_percent
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.id = $1
    `,
    [productId],
  );
  if (productRes.rowCount === 0) return null;

  const imagesRes = await pool.query(
    `SELECT id, image_url, sort_order FROM product_images WHERE product_id = $1 ORDER BY sort_order, id`,
    [productId],
  );
  const variantsRes = await pool.query(
    `SELECT id, label, grams, size_code, mrp, sale_price, stock_qty, is_default
     FROM product_variants WHERE product_id = $1 ORDER BY is_default DESC, id`,
    [productId],
  );
  const highlightsRes = await pool.query(
    `SELECT id, highlight, sort_order FROM product_highlights WHERE product_id = $1 ORDER BY sort_order, id`,
    [productId],
  );
  const nutritionRes = await pool.query(
    `SELECT id, nutrient, value, sort_order FROM product_nutrition WHERE product_id = $1 ORDER BY sort_order, id`,
    [productId],
  );

  const product = productRes.rows[0];
  return {
    ...product,
    images: imagesRes.rows,
    variants: variantsRes.rows,
    highlights: highlightsRes.rows,
    nutrition: nutritionRes.rows,
  };
}

const registry = createServiceRegistry({
  pool,
  logger: console,
  clock: Date,
  groups: {
    core: {
      pool,
    },
    auth: {
      requireFirebaseAuth,
      requireDriverRole,
    },
    dotbot: {
      createDotbotRateLimitMiddleware,
      DOTBOT_RATE_LIMIT_MESSAGE_LIMIT,
      DOTBOT_RATE_LIMIT_TRANSCRIBE_LIMIT,
      DOTBOT_RATE_LIMIT_TTS_LIMIT,
      DOTBOT_MESSAGE_MAX_WORDS,
      countWords,
      getDotbotModule,
    },
    users: {
      ensureUserRow,
      resolveUserIdFromIdentity,
      resolveUserRole,
    },
    wallet: {
      getDeliveryCreditBalance,
      getOrderCreditBalance,
      getAvailableOrderCreditBalance,
    },
    utils: {
      parseInteger,
      clamp,
      encodeCursor,
      decodeCursor,
      parseNullableNumber,
      roundCurrencyAmount,
      normalizePromoCode,
      normalizeFavoriteBookLabel,
      normalizePromoCodeForStorage,
      parseOptionalTimestamp,
      normalizePhoneNumber,
      normalizeReferralCode,
    },
    cache: {
      getProductsCacheVersion,
      bumpProductsCacheVersion,
      getOrdersCacheVersion,
      bumpOrdersCacheVersion,
      cacheSegment,
      getJsonCache,
      setJsonCache,
    },
    search: {
      PRODUCT_SEARCH_SEMANTIC_ENABLED,
      PRODUCT_SEARCH_SEMANTIC_MIN_QUERY_LENGTH,
      PRODUCT_SEARCH_VECTOR_MIN_SIMILARITY,
      PRODUCT_SEARCH_TRIGRAM_THRESHOLD,
      NORMALIZED_PRODUCT_SEARCH_TEXT_WEIGHT,
      NORMALIZED_PRODUCT_SEARCH_VECTOR_WEIGHT,
      NORMALIZED_PRODUCT_SEARCH_POPULARITY_WEIGHT,
      NORMALIZED_PRODUCT_SEARCH_STOCK_WEIGHT,
      getProductEmbeddings,
    },
    products: {
      PRODUCTS_CACHE_DEFAULT_LIMIT,
      PRODUCTS_CACHE_MIN_LIMIT,
      PRODUCTS_CACHE_MAX_LIMIT,
      PRODUCTS_CACHE_SHAPE_VERSION,
      getProductById,
      toSlug,
    },
    checkout: {
      ensurePricingSchema,
      createPendingOrderWithStockLock,
      calculateItemTotalFromItems,
      calculatePricingBreakdown,
      recalculatePendingOrderPricing,
      maybeCompleteReferralRewardForFirstPaidOrder,
    },
    payment: {
      stripeClient,
      stripePublishableKey,
      PLATFORM_CURRENCY,
    },
    realtime: {
      publishOrderRealtimeUpdate,
      publishOrderRealtimeUpdateFromRow,
      enqueueWalletRealtimeSync,
      processPendingWalletRealtimeSync,
      publishUserRealtimeWalletSnapshot,
    },
    orders: {
      ACTIVE_ORDER_STATUSES,
      PREVIOUS_ORDER_STATUSES,
      DRIVER_UPDATABLE_STATUSES,
      ORDERS_CACHE_SHAPE_VERSION,
      ORDERS_CACHE_TTL_SECONDS,
      ensureDriverOrderColumns,
      DRIVER_EXECUTED_VISIBLE_LIMIT,
      hydrateDriverOrderCustomerNames,
      archiveDeliveredOrdersForDriver,
    },
    admin: {
      resolveCategory,
      safeNum,
      CATEGORIES_CACHE_TTL_SECONDS,
      randomUUID,
      normalizeFeeRuleRow,
      coerceFeeType,
      normalizeDeliveryFeeSlabRow,
      assertNoActiveDeliverySlabOverlap,
      normalizePromoRow,
      coercePromoDiscountType,
    },
  },
});

registerApiRoutes(app, registry);

app.use(createErrorMiddleware({ nodeEnv: process.env.NODE_ENV }));

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(
      `[stripe] secret_key=${stripeSecretKey ? 'set' : 'missing'} ` +
        `publishable_key=${stripePublishableKey ? 'set' : 'missing'} ` +
        `webhook_secret=${stripeWebhookSecret ? 'set' : 'missing'} ` +
        `app_client_key=${appClientKey ? 'set' : 'missing'} ` +
        `admin_portal_api_key=${adminPortalApiKey ? 'set' : 'missing'} ` +
        `enforce_app_check=${enforceAppCheck ? 'true' : 'false'}`,
    );
    console.log(`Server listening on http://localhost:${port}`);
  });
}

module.exports = app;
