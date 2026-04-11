const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { Client } = require('pg');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const REQUIRED_CONFIRMATION = 'RESET_CATALOG';

function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  const parsed = {
    confirm: '',
    dryRun: false,
  };
  for (let i = 0; i < args.length; i += 1) {
    const current = String(args[i] || '').trim();
    if (current === '--confirm') {
      parsed.confirm = String(args[i + 1] || '').trim();
      i += 1;
      continue;
    }
    if (current === '--dry-run') {
      parsed.dryRun = true;
    }
  }
  return parsed;
}

function loadPostgresUrl() {
  let postgresUrl = String(process.env.POSTGRES_URL || '').trim();
  if (postgresUrl) return postgresUrl;

  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return '';
  const file = fs.readFileSync(envPath, 'utf8');
  const line = file
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith('POSTGRES_URL='));
  if (!line) return '';
  postgresUrl = line.split('=').slice(1).join('=').trim();
  return postgresUrl;
}

function normalizeConnectionString(url) {
  const raw = String(url || '').trim();
  if (!raw) return raw;
  if (!raw.includes('sslmode=verify-full')) return raw;
  const rootCertPath = path.join(process.env.HOME || '', '.postgresql', 'root.crt');
  if (rootCertPath && fs.existsSync(rootCertPath)) return raw;
  return raw.replace('sslmode=verify-full', 'sslmode=require');
}

async function queryCount(client, table) {
  const res = await client.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
  return Number(res.rows[0]?.count || 0);
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.confirm !== REQUIRED_CONFIRMATION) {
    throw new Error(
      `Refusing to run. Pass --confirm ${REQUIRED_CONFIRMATION} to permanently reset catalog data.`,
    );
  }

  const postgresUrl = normalizeConnectionString(loadPostgresUrl());
  if (!postgresUrl) {
    throw new Error('POSTGRES_URL is not configured in env.');
  }

  const client = new Client({
    connectionString: postgresUrl,
  });
  await client.connect();

  try {
    const before = {
      products: await queryCount(client, 'products'),
      product_images: await queryCount(client, 'product_images'),
      product_variants: await queryCount(client, 'product_variants'),
      product_highlights: await queryCount(client, 'product_highlights'),
      product_nutrition: await queryCount(client, 'product_nutrition'),
      product_embeddings: await queryCount(client, 'product_embeddings'),
      product_popularity: await queryCount(client, 'product_popularity'),
      product_favorites: await queryCount(client, 'product_favorites'),
      favorite_books: await queryCount(client, 'favorite_books'),
      categories: await queryCount(client, 'categories'),
      order_items: await queryCount(client, 'order_items'),
    };

    if (options.dryRun) {
      console.log(JSON.stringify({ ok: true, dry_run: true, before }, null, 2));
      return;
    }

    await client.query('BEGIN');
    await client.query(`
      TRUNCATE TABLE
        order_items,
        product_favorites,
        favorite_books,
        product_popularity,
        product_embeddings,
        product_nutrition,
        product_highlights,
        product_variants,
        product_images,
        products,
        categories
      RESTART IDENTITY;
    `);
    await client.query('COMMIT');

    const after = {
      products: await queryCount(client, 'products'),
      product_images: await queryCount(client, 'product_images'),
      product_variants: await queryCount(client, 'product_variants'),
      product_highlights: await queryCount(client, 'product_highlights'),
      product_nutrition: await queryCount(client, 'product_nutrition'),
      product_embeddings: await queryCount(client, 'product_embeddings'),
      product_popularity: await queryCount(client, 'product_popularity'),
      product_favorites: await queryCount(client, 'product_favorites'),
      favorite_books: await queryCount(client, 'favorite_books'),
      categories: await queryCount(client, 'categories'),
      order_items: await queryCount(client, 'order_items'),
    };

    console.log(
      JSON.stringify(
        {
          ok: true,
          reset: 'catalog',
          before,
          after,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_rollbackError) {}
    throw error;
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
