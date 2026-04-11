const path = require('path');
const dotenv = require('dotenv');
const { createHash } = require('crypto');
const { pool } = require('../src/db');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const PLATFORM_CURRENCY = 'aud';
const DEFAULT_LIMIT = Math.max(1, Number(process.env.ORDER_HASH_VERIFY_LIMIT || 1000));
const cliArgs = new Set(process.argv.slice(2));
const summaryOnly = cliArgs.has('--summary');
const showHelp = cliArgs.has('--help') || cliArgs.has('-h');

if (showHelp) {
  console.log('Usage: node scripts/verifyOrderIntegrityHashes.js [--summary]');
  process.exit(0);
}

function roundCurrencyAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function generateOrderIntegrityHash({ items, totalAmount, currency }) {
  const normalizedItems = Array.isArray(items) ? items : [];
  const canonicalItems = normalizedItems
    .map((item) => {
      const productId = Number(item?.product_id);
      const quantity = Number(item?.quantity);
      const unitPrice = roundCurrencyAmount(Number(item?.unit_price));
      if (!Number.isInteger(productId) || productId <= 0) return null;
      if (!Number.isInteger(quantity) || quantity <= 0) return null;
      if (!Number.isFinite(unitPrice) || unitPrice < 0) return null;
      return `${productId}:${quantity}:${unitPrice.toFixed(2)}`;
    })
    .filter(Boolean)
    .sort();
  const safeTotalAmount = roundCurrencyAmount(Number(totalAmount));
  const normalizedCurrency =
    String(currency || PLATFORM_CURRENCY).trim().toLowerCase() || PLATFORM_CURRENCY;
  const canonicalPayload = `${canonicalItems.join('|')}|total:${safeTotalAmount.toFixed(2)}|currency:${normalizedCurrency}`;
  return createHash('sha256').update(canonicalPayload, 'utf8').digest('hex');
}

async function run() {
  const client = await pool.connect();
  try {
    const rowsRes = await client.query(
      `
      WITH target_orders AS (
        SELECT id, total_amount, currency, order_hash
        FROM orders
        WHERE payment_status IN ('paid', 'completed')
        ORDER BY id ASC
        LIMIT $1
      )
      SELECT
        o.id,
        o.total_amount,
        o.currency,
        o.order_hash,
        oi.product_id,
        oi.quantity,
        oi.unit_price
      FROM target_orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      ORDER BY o.id ASC, oi.product_id ASC, oi.id ASC
      `,
      [DEFAULT_LIMIT],
    );

    const ordersById = new Map();
    for (const row of rowsRes.rows) {
      const orderId = Number(row.id);
      if (!ordersById.has(orderId)) {
        ordersById.set(orderId, {
          id: orderId,
          total_amount: row.total_amount,
          currency: row.currency,
          order_hash: row.order_hash,
          items: [],
        });
      }
      if (Number.isInteger(Number(row.product_id)) && Number(row.product_id) > 0) {
        ordersById.get(orderId).items.push({
          product_id: row.product_id,
          quantity: row.quantity,
          unit_price: row.unit_price,
        });
      }
    }
    const orders = Array.from(ordersById.values());

    let matched = 0;
    let mismatched = 0;
    let missingHash = 0;

    for (const order of orders) {
      const recomputed = generateOrderIntegrityHash({
        items: order.items,
        totalAmount: order.total_amount,
        currency: order.currency,
      });
      const storedHash = String(order.order_hash || '').trim().toLowerCase();

      if (!storedHash) {
        missingHash += 1;
        if (!summaryOnly) {
          console.log(`Order ${order.id} ⚠ MISSING HASH`);
        }
        continue;
      }

      if (storedHash === recomputed) {
        matched += 1;
        if (!summaryOnly) {
          console.log(`Order ${order.id} OK`);
        }
      } else {
        mismatched += 1;
        if (!summaryOnly) {
          console.log(`Order ${order.id} HASH MISMATCH`);
          console.log(`Stored:   ${storedHash}`);
          console.log(`Computed: ${recomputed}`);
        }
      }
    }

    console.log('');
    console.log('Order Hash Verification Summary');
    console.log(`Scanned: ${orders.length}`);
    console.log(`OK: ${matched}`);
    console.log(`Mismatch: ${mismatched}`);
    console.log(`Missing: ${missingHash}`);

    if (mismatched > 0) {
      process.exitCode = 1;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error) => {
  console.error('Order hash verification failed:', error.message);
  process.exit(1);
});
