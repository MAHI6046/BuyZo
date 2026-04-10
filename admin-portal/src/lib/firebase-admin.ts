import fs from 'node:fs';
import path from 'node:path';
import {
  cert,
  getApps,
  initializeApp,
  type App,
  type ServiceAccount,
} from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

let cachedApp: App | null = null;

function parseServiceAccount(raw: string): ServiceAccount {
  const parsed = JSON.parse(raw) as
    | ServiceAccount
    | {
        project_id?: string;
        client_email?: string;
        private_key?: string;
      };

  const projectId =
    (parsed as ServiceAccount).projectId ||
    (parsed as { project_id?: string }).project_id ||
    '';
  const clientEmail =
    (parsed as ServiceAccount).clientEmail ||
    (parsed as { client_email?: string }).client_email ||
    '';
  const privateKeyRaw =
    (parsed as ServiceAccount).privateKey ||
    (parsed as { private_key?: string }).private_key ||
    '';
  const privateKey = String(privateKeyRaw).replace(/\\n/g, '\n');

  if (!clientEmail || !privateKey || !projectId) {
    throw new Error('Firebase service account JSON is missing required fields');
  }

  return {
    projectId,
    clientEmail,
    privateKey,
  };
}

function readServiceAccount(): ServiceAccount {
  const rawJson = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (rawJson) {
    return parseServiceAccount(rawJson);
  }

  const accountPath = (process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '').trim();
  if (!accountPath) {
    throw new Error(
      'Firebase Admin is not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH.',
    );
  }

  const resolvedPath = path.isAbsolute(accountPath)
    ? accountPath
    : path.join(process.cwd(), accountPath);
  const fileContent = fs.readFileSync(resolvedPath, 'utf8');
  return parseServiceAccount(fileContent);
}

function getFirebaseAdminApp(): App {
  if (cachedApp) {
    return cachedApp;
  }

  if (getApps().length > 0) {
    cachedApp = getApps()[0] as App;
    return cachedApp;
  }

  const serviceAccount = readServiceAccount();
  const explicitProjectId = (process.env.FIREBASE_PROJECT_ID || '').trim();

  cachedApp = initializeApp({
    credential: cert(serviceAccount),
    projectId: explicitProjectId || serviceAccount.projectId,
  });

  return cachedApp;
}

export function getFirebaseAdminAuth() {
  return getAuth(getFirebaseAdminApp());
}
