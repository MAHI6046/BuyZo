-- Move Firestore-owned tables from public schema to legacy schema in Neon.
-- Run only after you have migrated data and switched application reads/writes.
-- Example:
--   psql "$POSTGRES_URL" -f backend/scripts/neon_migrate_to_firestore.sql

BEGIN;

CREATE SCHEMA IF NOT EXISTS legacy;

DO $$
DECLARE
  tbl text;
  tables_to_archive text[] := ARRAY[
    'users',
    'categories',
    'products',
    'product_images',
    'product_variants',
    'product_highlights',
    'product_nutrition',
    'product_favorites',
    'carts',
    'cart_items',
    'orders',
    'order_items',
    'payments',
    'coupons',
    'order_discounts',
    'store_products',
    'user_addresses'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables_to_archive LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('ALTER TABLE public.%I SET SCHEMA legacy', tbl);
      RAISE NOTICE 'Archived table public.% to legacy.%', tbl, tbl;
    ELSE
      RAISE NOTICE 'Skipping %. Not found in public schema.', tbl;
    END IF;
  END LOOP;
END $$;

COMMIT;
