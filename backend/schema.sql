-- DOT backend schema for PostgreSQL / Neon

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
  discount_percent NUMERIC(5,2) GENERATED ALWAYS AS (
    CASE
      WHEN price_mrp > 0 THEN ROUND(((price_mrp - price_sale) / price_mrp) * 100, 2)
      ELSE 0
    END
  ) STORED,
  stock_qty INTEGER NOT NULL DEFAULT 0,
  search_vector tsvector,
  primary_image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  firebase_uid VARCHAR(128),
  delivery_address_id BIGINT,
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

ALTER TABLE products
ADD COLUMN IF NOT EXISTS store_id VARCHAR(80) NOT NULL DEFAULT 'default';

ALTER TABLE products
ADD COLUMN IF NOT EXISTS search_vector tsvector;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS delivery_address_id BIGINT;

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

CREATE TABLE IF NOT EXISTS user_wallet_balances (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  delivery_credits_balance INT NOT NULL DEFAULT 0,
  order_credits_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

ALTER TABLE users
ADD COLUMN IF NOT EXISTS referral_code TEXT;

ALTER TABLE users
ADD COLUMN IF NOT EXISTS referred_by BIGINT;

ALTER TABLE users
DROP CONSTRAINT IF EXISTS users_referred_by_fkey;

ALTER TABLE users
ADD CONSTRAINT users_referred_by_fkey
FOREIGN KEY (referred_by) REFERENCES users(id) ON DELETE SET NULL;

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

ALTER TABLE orders
DROP CONSTRAINT IF EXISTS orders_delivery_address_id_fkey;

ALTER TABLE orders
ADD CONSTRAINT orders_delivery_address_id_fkey
FOREIGN KEY (delivery_address_id) REFERENCES user_addresses(id) ON DELETE SET NULL;

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

CREATE INDEX IF NOT EXISTS idx_users_phone_number ON users(phone_number);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_products_store_active ON products(store_id, is_active);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_search_vector ON products USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING GIN (LOWER(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_brand_trgm ON products USING GIN (LOWER(COALESCE(brand, '')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_slug_trgm ON products USING GIN (LOWER(COALESCE(slug, '')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_product_images_product_id ON product_images(product_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_product_highlights_product_id ON product_highlights(product_id);
CREATE INDEX IF NOT EXISTS idx_product_nutrition_product_id ON product_nutrition(product_id);
CREATE INDEX IF NOT EXISTS idx_product_embeddings_updated_at ON product_embeddings(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_popularity_total_qty ON product_popularity(total_qty DESC);
CREATE INDEX IF NOT EXISTS idx_favorite_books_user_sort ON favorite_books(user_firebase_uid, sort_order, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_favorites_book_product_unique ON product_favorites(book_id, product_id);
CREATE INDEX IF NOT EXISTS idx_product_favorites_user_uid ON product_favorites(user_firebase_uid);
CREATE INDEX IF NOT EXISTS idx_product_favorites_book_id ON product_favorites(book_id);
CREATE INDEX IF NOT EXISTS idx_categories_active ON categories(is_active);
CREATE INDEX IF NOT EXISTS idx_categories_active_sort_order ON categories(is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_orders_firebase_uid_created_at ON orders(firebase_uid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_firebase_uid_status_created_at ON orders(firebase_uid, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_assigned_driver_status ON orders(assigned_driver_uid, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_paid_assignable ON orders(payment_status, status, assigned_driver_uid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_driver_executed_archive ON orders(assigned_driver_uid, status, driver_executed_archived_at, delivered_at DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_fee_rule_id ON orders(fee_rule_id);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_fee ON orders(delivery_fee);
CREATE INDEX IF NOT EXISTS idx_orders_promo_code ON orders(promo_code);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id_id ON order_items(order_id, id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order_picked ON order_items(order_id, picked_by_driver);
CREATE INDEX IF NOT EXISTS idx_user_addresses_user_default ON user_addresses(user_id, is_default);
CREATE INDEX IF NOT EXISTS idx_driver_access_phone_active ON driver_access(phone_number, is_active);
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

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_products_updated_at ON products;
CREATE TRIGGER trg_products_updated_at
BEFORE UPDATE ON products
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_products_search_vector ON products;
CREATE TRIGGER trg_products_search_vector
BEFORE INSERT OR UPDATE OF name, brand, slug
ON products
FOR EACH ROW
EXECUTE FUNCTION products_search_vector_update();

DROP TRIGGER IF EXISTS trg_product_variants_updated_at ON product_variants;
CREATE TRIGGER trg_product_variants_updated_at
BEFORE UPDATE ON product_variants
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_categories_updated_at ON categories;
CREATE TRIGGER trg_categories_updated_at
BEFORE UPDATE ON categories
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_orders_updated_at ON orders;
CREATE TRIGGER trg_orders_updated_at
BEFORE UPDATE ON orders
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_orders_cancellation_reason ON orders;
CREATE TRIGGER trg_orders_cancellation_reason
BEFORE INSERT OR UPDATE OF status, cancellation_reason
ON orders
FOR EACH ROW
EXECUTE FUNCTION ensure_orders_cancellation_reason();

DROP TRIGGER IF EXISTS trg_fee_rules_updated_at ON fee_rules;
CREATE TRIGGER trg_fee_rules_updated_at
BEFORE UPDATE ON fee_rules
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_delivery_fee_slabs_updated_at ON delivery_fee_slabs;
CREATE TRIGGER trg_delivery_fee_slabs_updated_at
BEFORE UPDATE ON delivery_fee_slabs
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_promo_codes_updated_at ON promo_codes;
CREATE TRIGGER trg_promo_codes_updated_at
BEFORE UPDATE ON promo_codes
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_user_addresses_updated_at ON user_addresses;
CREATE TRIGGER trg_user_addresses_updated_at
BEFORE UPDATE ON user_addresses
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

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
