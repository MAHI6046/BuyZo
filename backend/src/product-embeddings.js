const OpenAI = require('openai');
const { pool } = require('./db');

const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
const DEFAULT_EMBEDDING_DIMENSION = 1536;

let openaiClient = null;
let embeddingSchemaInitPromise = null;
let nonBlockingWarningShown = false;
const searchQueryEmbeddingCache = new Map();
let searchQueryEmbeddingBackoffUntilMs = 0;

const SEARCH_QUERY_CACHE_MAX_ENTRIES = Math.max(
  50,
  parseIntegerEnv(process.env.PRODUCT_SEARCH_QUERY_CACHE_MAX_ENTRIES, 300),
);
const SEARCH_QUERY_CACHE_TTL_MS = Math.max(
  60 * 1000,
  parseIntegerEnv(process.env.PRODUCT_SEARCH_QUERY_CACHE_TTL_SECONDS, 3600) * 1000,
);
const SEARCH_QUERY_EMBEDDING_TIMEOUT_MS = Math.max(
  200,
  parseIntegerEnv(process.env.PRODUCT_SEARCH_QUERY_EMBEDDING_TIMEOUT_MS, 450),
);
const SEARCH_QUERY_EMBEDDING_BACKOFF_MS = Math.max(
  60 * 1000,
  parseIntegerEnv(process.env.PRODUCT_SEARCH_QUERY_EMBEDDING_BACKOFF_SECONDS, 300) * 1000,
);

function parseBooleanEnv(value, fallback) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === 'true';
}

function parseIntegerEnv(value, fallback) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isEmbeddingsEnabled() {
  return parseBooleanEnv(process.env.PRODUCT_EMBEDDINGS_ENABLED, true);
}

function isEmbeddingsRequired() {
  return parseBooleanEnv(process.env.PRODUCT_EMBEDDINGS_REQUIRED, false);
}

function getEmbeddingModel() {
  return String(process.env.OPENAI_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL).trim();
}

function getEmbeddingDimension() {
  return parseIntegerEnv(
    process.env.OPENAI_EMBEDDING_DIMENSION,
    DEFAULT_EMBEDDING_DIMENSION,
  );
}

function getOpenAIClient() {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('Product embedding is enabled but OPENAI_API_KEY is missing');
  }
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

async function ensureEmbeddingSchema() {
  if (embeddingSchemaInitPromise) return embeddingSchemaInitPromise;
  const dimension = getEmbeddingDimension();

  embeddingSchemaInitPromise = pool.query(`
    CREATE EXTENSION IF NOT EXISTS vector;

    CREATE TABLE IF NOT EXISTS product_embeddings (
      product_id BIGINT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
      embedding vector(${dimension}) NOT NULL,
      embedding_model VARCHAR(120) NOT NULL,
      source_text TEXT NOT NULL,
      metadata JSONB,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_product_embeddings_updated_at
      ON product_embeddings(updated_at DESC);
  `);

  return embeddingSchemaInitPromise;
}

function logNonBlockingWarningOnce(actionName, error) {
  if (nonBlockingWarningShown) return;
  nonBlockingWarningShown = true;
  console.error(
    `[embeddings] product embedding ${actionName} skipped: ${error?.message || String(error)}`,
  );
}

function getQueryable(dbClient) {
  if (dbClient && typeof dbClient.query === 'function') {
    return dbClient;
  }
  return pool;
}

async function runEmbeddingAction(actionName, action) {
  try {
    return await action();
  } catch (error) {
    if (isEmbeddingsRequired()) {
      throw error;
    }
    logNonBlockingWarningOnce(actionName, error);
    return {
      skipped: true,
      reason: 'non_blocking_error',
      message: error?.message || String(error),
    };
  }
}

function normalizeStringArray(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object' && 'highlight' in item) {
        return String(item.highlight || '').trim();
      }
      return '';
    })
    .filter(Boolean);
}

function normalizeNutrition(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((row) => {
      if (!row || typeof row !== 'object') return '';
      const nutrient = String(row.nutrient || '').trim();
      const value = String(row.value || '').trim();
      if (!nutrient || !value) return '';
      return `${nutrient}: ${value}`;
    })
    .filter(Boolean);
}

function normalizeVariants(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((variant) => {
      if (!variant || typeof variant !== 'object') return '';
      const label = String(variant.label || '').trim();
      if (!label) return '';
      const salePrice = Number(variant.sale_price);
      const mrp = Number(variant.mrp);
      const stockQty = Number(variant.stock_qty);
      const parts = [label];
      if (Number.isFinite(salePrice)) parts.push(`sale ${salePrice}`);
      if (Number.isFinite(mrp)) parts.push(`mrp ${mrp}`);
      if (Number.isFinite(stockQty)) parts.push(`stock ${stockQty}`);
      return parts.join(', ');
    })
    .filter(Boolean);
}

function buildEmbeddingText(product) {
  const lines = [];
  const name = String(product?.name || '').trim();
  if (name) lines.push(`Name: ${name}`);

  const brand = String(product?.brand || '').trim();
  if (brand) lines.push(`Brand: ${brand}`);

  const category = String(product?.category || '').trim();
  if (category) lines.push(`Category: ${category}`);

  const shortDescription = String(product?.short_description || '').trim();
  if (shortDescription) lines.push(`Short description: ${shortDescription}`);

  const description = String(product?.description || '').trim();
  if (description) lines.push(`Description: ${description}`);

  const highlights = normalizeStringArray(product?.highlights);
  if (highlights.length > 0) lines.push(`Highlights: ${highlights.join('; ')}`);

  const variants = normalizeVariants(product?.variants);
  if (variants.length > 0) lines.push(`Variants: ${variants.join(' | ')}`);

  const nutrition = normalizeNutrition(product?.nutrition);
  if (nutrition.length > 0) lines.push(`Nutrition: ${nutrition.join('; ')}`);

  const priceSale = Number(product?.price_sale);
  if (Number.isFinite(priceSale)) lines.push(`Sale price: ${priceSale}`);

  return lines.join('\n').trim();
}

async function createEmbedding(inputText) {
  const client = getOpenAIClient();
  const response = await client.embeddings.create({
    model: getEmbeddingModel(),
    input: inputText,
  });
  const embedding = response?.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('OpenAI embedding response did not contain a vector');
  }
  const expectedDimension = getEmbeddingDimension();
  if (embedding.length !== expectedDimension) {
    throw new Error(
      `Embedding dimension mismatch: expected ${expectedDimension}, got ${embedding.length}`,
    );
  }
  return embedding;
}

function toVectorLiteral(embedding) {
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('Embedding vector is empty');
  }
  const values = embedding.map((value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      throw new Error('Embedding contains non-numeric values');
    }
    return String(numeric);
  });
  return `[${values.join(',')}]`;
}

function getCachedSearchQueryVector(queryKey) {
  const entry = searchQueryEmbeddingCache.get(queryKey);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    searchQueryEmbeddingCache.delete(queryKey);
    return null;
  }
  entry.lastAccess = Date.now();
  return entry.vectorLiteral;
}

function setCachedSearchQueryVector(queryKey, vectorLiteral) {
  if (!queryKey || !vectorLiteral) return;
  const now = Date.now();
  searchQueryEmbeddingCache.set(queryKey, {
    vectorLiteral,
    expiresAt: now + SEARCH_QUERY_CACHE_TTL_MS,
    lastAccess: now,
  });
  if (searchQueryEmbeddingCache.size <= SEARCH_QUERY_CACHE_MAX_ENTRIES) return;

  let oldestKey = null;
  let oldestAccess = Number.POSITIVE_INFINITY;
  for (const [key, value] of searchQueryEmbeddingCache.entries()) {
    if (value.lastAccess < oldestAccess) {
      oldestAccess = value.lastAccess;
      oldestKey = key;
    }
  }
  if (oldestKey) {
    searchQueryEmbeddingCache.delete(oldestKey);
  }
}

async function buildSearchQueryEmbeddingVectorLiteral(rawQuery) {
  if (!isEmbeddingsEnabled()) return null;
  if (Date.now() < searchQueryEmbeddingBackoffUntilMs) {
    return null;
  }
  const query = String(rawQuery || '')
    .trim()
    .toLowerCase();
  if (!query) return null;

  const cached = getCachedSearchQueryVector(query);
  if (cached) return cached;

  try {
    const embedding = await Promise.race([
      createEmbedding(query),
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('Search query embedding timed out'));
        }, SEARCH_QUERY_EMBEDDING_TIMEOUT_MS);
      }),
    ]);
    const vectorLiteral = toVectorLiteral(embedding);
    setCachedSearchQueryVector(query, vectorLiteral);
    return vectorLiteral;
  } catch (error) {
    const status = Number(error?.status || 0);
    const message = String(error?.message || '').toLowerCase();
    if (status === 429 || message.includes('quota') || message.includes('rate limit')) {
      searchQueryEmbeddingBackoffUntilMs = Date.now() + SEARCH_QUERY_EMBEDDING_BACKOFF_MS;
    }
    logNonBlockingWarningOnce('search-query', error);
    return null;
  }
}

function toEmbeddingMetadata(product) {
  const stockQty = Number(product?.stock_qty);
  const priceSale = Number(product?.price_sale);
  return {
    name: String(product?.name || '').trim() || null,
    slug: String(product?.slug || '').trim() || null,
    category: String(product?.category || '').trim() || null,
    brand: String(product?.brand || '').trim() || null,
    is_active: typeof product?.is_active === 'boolean' ? product.is_active : null,
    price_sale: Number.isFinite(priceSale) ? priceSale : null,
    stock_qty: Number.isFinite(stockQty) ? stockQty : null,
    updated_at: new Date().toISOString(),
  };
}

async function upsertProductEmbedding(product, dbClient) {
  if (!isEmbeddingsEnabled()) {
    return { skipped: true };
  }
  return runEmbeddingAction('upsert', async () => {
    if (!product || !product.id) {
      throw new Error('Cannot create embedding without product id');
    }

    const text = buildEmbeddingText(product);
    if (!text) {
      throw new Error('Cannot create embedding because product text is empty');
    }

    const embedding = await createEmbedding(text);
    const vectorLiteral = toVectorLiteral(embedding);
    await ensureEmbeddingSchema();
    const queryable = getQueryable(dbClient);

    await queryable.query(
      `
      INSERT INTO product_embeddings (
        product_id, embedding, embedding_model, source_text, metadata, updated_at
      ) VALUES ($1, $2::vector, $3, $4, $5::jsonb, NOW())
      ON CONFLICT (product_id)
      DO UPDATE SET
        embedding = EXCLUDED.embedding,
        embedding_model = EXCLUDED.embedding_model,
        source_text = EXCLUDED.source_text,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
      `,
      [
        Number(product.id),
        vectorLiteral,
        getEmbeddingModel(),
        text,
        JSON.stringify(toEmbeddingMetadata(product)),
      ],
    );
    return { ok: true };
  });
}

async function deleteProductEmbedding(productId, dbClient) {
  if (!isEmbeddingsEnabled()) {
    return { skipped: true };
  }
  if (!productId) {
    return { skipped: true };
  }
  return runEmbeddingAction('delete', async () => {
    await ensureEmbeddingSchema();
    const queryable = getQueryable(dbClient);
    await queryable.query(`DELETE FROM product_embeddings WHERE product_id = $1`, [
      Number(productId),
    ]);
    return { ok: true };
  });
}

module.exports = {
  upsertProductEmbedding,
  deleteProductEmbedding,
  buildSearchQueryEmbeddingVectorLiteral,
};
