const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const { Client } = require('pg');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const REQUIRED_CONFIRMATION = 'RESET_ALL_DB';

function parseArgs(argv) {
  const parsed = { confirm: '', dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const current = String(argv[i] || '').trim();
    if (current === '--confirm') {
      parsed.confirm = String(argv[i + 1] || '').trim();
      i += 1;
      continue;
    }
    if (current === '--dry-run') parsed.dryRun = true;
  }
  return parsed;
}

function loadPostgresUrl() {
  const fromEnv = String(process.env.POSTGRES_URL || '').trim();
  if (fromEnv) return fromEnv;
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return '';
  const line = fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith('POSTGRES_URL='));
  if (!line) return '';
  return line.split('=').slice(1).join('=').trim();
}

function normalizeConnectionString(url) {
  const raw = String(url || '').trim();
  if (!raw.includes('sslmode=verify-full')) return raw;
  const rootCertPath = path.join(process.env.HOME || '', '.postgresql', 'root.crt');
  if (rootCertPath && fs.existsSync(rootCertPath)) return raw;
  return raw.replace('sslmode=verify-full', 'sslmode=require');
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.confirm !== REQUIRED_CONFIRMATION) {
    throw new Error(
      `Refusing to run. Pass --confirm ${REQUIRED_CONFIRMATION} to wipe all table data.`,
    );
  }

  const postgresUrl = normalizeConnectionString(loadPostgresUrl());
  if (!postgresUrl) throw new Error('POSTGRES_URL is not configured.');

  const client = new Client({ connectionString: postgresUrl });
  await client.connect();

  try {
    const tablesRes = await client.query(
      `
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename ASC
      `,
    );
    const tables = tablesRes.rows
      .map((row) => String(row.tablename || '').trim())
      .filter(Boolean);

    if (tables.length === 0) {
      console.log(JSON.stringify({ ok: true, wiped_tables: 0, tables: [] }, null, 2));
      return;
    }

    if (options.dryRun) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            dry_run: true,
            tables_count: tables.length,
            tables,
          },
          null,
          2,
        ),
      );
      return;
    }

    const qualified = tables.map((name) => `"public"."${name}"`).join(', ');
    await client.query('BEGIN');
    await client.query(`TRUNCATE TABLE ${qualified} RESTART IDENTITY CASCADE`);
    await client.query('COMMIT');

    console.log(
      JSON.stringify(
        {
          ok: true,
          wiped_tables: tables.length,
          tables,
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
