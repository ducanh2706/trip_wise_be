import fs from 'node:fs';
import { initializeApp, cert, getApps, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import { env } from '@/config/env';

// FCM push is best-effort: if no service-account JSON is present (or it is
// unreadable), the server still runs normally — push sends become no-ops.
// This module NEVER throws at import time so src/index.ts can't be broken
// by a missing credential file.

let app: App | null = null;
let warned = false;

function initFirebase(): App | null {
  if (app) return app;
  if (getApps().length > 0) {
    app = getApps()[0];
    return app;
  }
  try {
    const raw = fs.readFileSync(env.firebaseServiceAccount, 'utf8');
    const serviceAccount = JSON.parse(raw);
    app = initializeApp({ credential: cert(serviceAccount) });
    console.log('[push] Firebase initialized — FCM push enabled');
    return app;
  } catch {
    if (!warned) {
      console.log(
        `[push] Firebase disabled (no service account at ${env.firebaseServiceAccount}) — push is a no-op`,
      );
      warned = true;
    }
    return null;
  }
}

export const isFirebaseEnabled: boolean = initFirebase() !== null;

export function getMessagingOrNull(): Messaging | null {
  const a = initFirebase();
  return a ? getMessaging(a) : null;
}

export function getFirebaseAuthOrNull(): Auth | null {
  const a = initFirebase();
  return a ? getAuth(a) : null;
}
