require('dotenv').config();

const { pool } = require('../src/db');
const { upsertProductEmbedding } = require('../src/product-embeddings');

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value, fallback) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === 'true';
}

const BATCH_SIZE = parsePositiveInt(process.env.EMBEDDINGS_BACKFILL_BATCH_SIZE, 20);
const LIMIT = parsePositiveInt(process.env.EMBEDDINGS_BACKFILL_LIMIT, 0);
const ONLY_MISSING = parseBoolean(process.env.EMBEDDINGS_BACKFILL_ONLY_MISSING, true);

async function fetchBatch(limit, lastId, onlyMissing) {
  const params = [lastId, limit];
  const missingFilter = onlyMissing
    ? `AND NOT EXISTS (
         SELECT 1
         FROM product_embeddings pe
         WHERE pe.product_id = p.id
       )`
    : '';

  const result = await pool.query(
    `
    SELECT
      p.id,
      p.name,
      p.slug,
      p.short_description,
      p.description,
      COALESCE(c.name, p.category) AS category,
      p.brand,
      p.is_active,
      p.price_sale,
      p.stock_qty,
      COALESCE((
        SELECT json_agg(
          json_build_object('highlight', h.highlight)
          ORDER BY h.sort_order, h.id
        )
        FROM product_highlights h
        WHERE h.product_id = p.id
      ), '[]'::json) AS highlights,
      COALESCE((
        SELECT json_agg(
          json_build_object('nutrient', n.nutrient, 'value', n.value)
          ORDER BY n.sort_order, n.id
        )
        FROM product_nutrition n
        WHERE n.product_id = p.id
      ), '[]'::json) AS nutrition,
      COALESCE((
        SELECT json_agg(
          json_build_object(
            'label', v.label,
            'sale_price', v.sale_price,
            'mrp', v.mrp,
            'stock_qty', v.stock_qty
          )
          ORDER BY v.is_default DESC, v.id
        )
        FROM product_variants v
        WHERE v.product_id = p.id
      ), '[]'::json) AS variants
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.id > $1
    ${missingFilter}
    ORDER BY p.id ASC
    LIMIT $2
    `,
    params,
  );

  return result.rows;
}

async function main() {
  if (!String(process.env.OPENAI_API_KEY || '').trim()) {
    throw new Error('OPENAI_API_KEY is missing');
  }

  let lastId = 0;
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  const startedAt = Date.now();

  while (true) {
    if (LIMIT > 0 && processed >= LIMIT) break;
    const remaining = LIMIT > 0 ? Math.max(0, LIMIT - processed) : BATCH_SIZE;
    const currentBatchSize = Math.min(BATCH_SIZE, remaining || BATCH_SIZE);
    if (currentBatchSize <= 0) break;

    const rows = await fetchBatch(currentBatchSize, lastId, ONLY_MISSING);
    if (rows.length === 0) break;

    for (const product of rows) {
      processed += 1;
      try {
        await upsertProductEmbedding(product);
        succeeded += 1;
      } catch (error) {
        failed += 1;
        console.error(
          `[embeddings-backfill] failed product_id=${product.id}: ${error?.message || String(error)}`,
        );
      }

      if (processed % 10 === 0) {
        console.log(
          `[embeddings-backfill] progress processed=${processed} succeeded=${succeeded} failed=${failed}`,
        );
      }
    }

    lastId = Number(rows[rows.length - 1].id) || lastId;
  }

  const durationSeconds = Math.round((Date.now() - startedAt) / 1000);
  console.log(
    `[embeddings-backfill] done processed=${processed} succeeded=${succeeded} failed=${failed} duration_s=${durationSeconds}`,
  );

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(`[embeddings-backfill] fatal: ${error?.message || String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
