-- Restores archived tables from legacy schema back to public schema.
-- Run:
--   psql "$POSTGRES_URL" -f backend/scripts/restore_neon_public_from_legacy.sql

BEGIN;

DO $$
DECLARE
  tbl text;
  tables_to_restore text[] := ARRAY[
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
  FOREACH tbl IN ARRAY tables_to_restore LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'legacy' AND table_name = tbl
    ) THEN
      EXECUTE format('ALTER TABLE legacy.%I SET SCHEMA public', tbl);
      RAISE NOTICE 'Restored table legacy.% to public.%', tbl, tbl;
    ELSE
      RAISE NOTICE 'Skipping legacy.%. Not found.', tbl;
    END IF;
  END LOOP;
END $$;

COMMIT;
