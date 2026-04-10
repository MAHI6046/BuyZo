const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const firebaseAdmin = require('firebase-admin');
const { pool } = require('../src/infra/db');
const { createRealtimeServices } = require('../src/infra/realtime');
const { parseInteger } = require('../src/utils/numbers');
const { normalizeReferralCode } = require('../src/normalizers');
const { roundCurrencyAmount } = require('../src/checkout/math');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

function parseBooleanEnv(value, fallback) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === 'true';
}

function loadFirebaseServiceAccountJson() {
  const inlineJson = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (inlineJson) return inlineJson;

  const configuredPath = String(process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '').trim();
  if (!configuredPath) return '';

  const resolvedPath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(__dirname, '..', configuredPath);
  return fs.readFileSync(resolvedPath, 'utf8').trim();
}

let firebaseReady = false;

function ensureFirebase() {
  if (firebaseReady) return;
  if (firebaseAdmin.apps.length > 0) {
    firebaseReady = true;
    return;
  }
  const rawServiceAccount = loadFirebaseServiceAccountJson();
  const projectId = String(process.env.FIREBASE_PROJECT_ID || '').trim();

  if (rawServiceAccount) {
    const serviceAccount = JSON.parse(rawServiceAccount);
    const effectiveProjectId =
      String(serviceAccount?.project_id || '').trim() || projectId || undefined;
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
    } else if (effectiveProjectId) {
      firebaseAdmin.initializeApp({ projectId: effectiveProjectId });
    } else {
      throw new Error(
        'Firebase Admin is not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_PROJECT_ID',
      );
    }
  } else if (projectId) {
    firebaseAdmin.initializeApp({ projectId });
  } else {
    throw new Error(
      'Firebase Admin is not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_PROJECT_ID',
    );
  }

  firebaseReady = true;
}

function getFirebaseAdminFirestore() {
  ensureFirebase();
  return firebaseAdmin.firestore();
}

function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  const parsed = {
    uid: '',
    limit: 200,
    batch: 50,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const current = String(args[i] || '').trim();
    if (current === '--uid') {
      parsed.uid = String(args[i + 1] || '').trim();
      i += 1;
    } else if (current === '--limit') {
      parsed.limit = Math.max(1, parseInteger(args[i + 1], 200));
      i += 1;
    } else if (current === '--batch') {
      parsed.batch = Math.max(1, Math.min(100, parseInteger(args[i + 1], 50)));
      i += 1;
    } else if (current === '--dry-run') {
      parsed.dryRun = true;
    }
  }

  return parsed;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const realtime = createRealtimeServices({
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
    platformCurrency: 'aud',
  });

  const enqueuedUids = [];
  if (options.uid) {
    enqueuedUids.push(options.uid);
  } else {
    const usersRes = await pool.query(
      `
      SELECT firebase_uid
      FROM users
      WHERE NULLIF(BTRIM(firebase_uid), '') IS NOT NULL
      ORDER BY updated_at DESC NULLS LAST, id DESC
      LIMIT $1
      `,
      [options.limit],
    );
    for (const row of usersRes.rows) {
      const uid = String(row.firebase_uid || '').trim();
      if (uid) enqueuedUids.push(uid);
    }
  }

  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: 'dry-run',
          count: enqueuedUids.length,
          uid: options.uid || null,
        },
        null,
        2,
      ),
    );
    return;
  }

  let enqueued = 0;
  const enqueueClient = await pool.connect();
  try {
    await enqueueClient.query('BEGIN');
    for (const uid of enqueuedUids) {
      const didEnqueue = await realtime.enqueueWalletRealtimeSync(
        enqueueClient,
        uid,
        'manual_reconcile',
      );
      if (didEnqueue) enqueued += 1;
    }
    await enqueueClient.query('COMMIT');
  } catch (error) {
    try {
      await enqueueClient.query('ROLLBACK');
    } catch (_rollbackError) {}
    throw error;
  } finally {
    enqueueClient.release();
  }

  let totalProcessed = 0;
  let totalSucceeded = 0;
  let totalFailed = 0;
  while (true) {
    const result = await realtime.processPendingWalletRealtimeSync({
      limit: options.batch,
    });
    totalProcessed += Number(result.processed || 0);
    totalSucceeded += Number(result.succeeded || 0);
    totalFailed += Number(result.failed || 0);
    if (!result.processed) break;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        enqueued,
        processed: totalProcessed,
        succeeded: totalSucceeded,
        failed: totalFailed,
      },
      null,
      2,
    ),
  );
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const gracefulShutdown = parseBooleanEnv(process.env.RECONCILE_SHUTDOWN_POOL, true);
    if (gracefulShutdown) {
      try {
        await pool.end();
      } catch (_error) {}
    }
  });
