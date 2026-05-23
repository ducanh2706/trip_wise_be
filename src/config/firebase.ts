import { createVerify } from 'node:crypto';
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
let certCache: { expiresAt: number; certs: Record<string, string> } | null = null;

const FIREBASE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

export interface VerifiedFirebaseIdToken {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
}

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

export function canVerifyFirebaseIdTokens(): boolean {
  return getFirebaseAuthOrNull() !== null || env.firebaseProjectId.trim().length > 0;
}

export async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFirebaseIdToken> {
  const auth = getFirebaseAuthOrNull();
  if (auth) {
    return auth.verifyIdToken(idToken);
  }

  return verifyFirebaseIdTokenWithPublicCerts(idToken);
}

async function verifyFirebaseIdTokenWithPublicCerts(
  idToken: string,
): Promise<VerifiedFirebaseIdToken> {
  const projectId = env.firebaseProjectId.trim();
  if (!projectId) throw new Error('Firebase project ID is not configured');

  const [encodedHeader, encodedPayload, encodedSignature] = idToken.split('.');
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new Error('Malformed Firebase ID token');
  }

  const header = parseJwtPart(encodedHeader);
  const payload = parseJwtPart(encodedPayload);
  const kid = stringField(header.kid);
  if (stringField(header.alg) !== 'RS256' || !kid) {
    throw new Error('Unsupported Firebase ID token header');
  }

  const certs = await getFirebasePublicCerts();
  const cert = certs[kid];
  if (!cert) throw new Error('Unknown Firebase ID token key');

  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${encodedHeader}.${encodedPayload}`);
  verifier.end();
  const signatureIsValid = verifier.verify(cert, Buffer.from(encodedSignature, 'base64url'));
  if (!signatureIsValid) throw new Error('Invalid Firebase ID token signature');

  const nowSeconds = Math.floor(Date.now() / 1000);
  const exp = numberField(payload.exp);
  const iat = numberField(payload.iat);
  const aud = stringField(payload.aud);
  const iss = stringField(payload.iss);
  const uid = stringField(payload.sub);

  if (!exp || exp <= nowSeconds) throw new Error('Expired Firebase ID token');
  if (!iat || iat > nowSeconds + 300) throw new Error('Invalid Firebase ID token issue time');
  if (aud !== projectId) throw new Error('Firebase ID token audience mismatch');
  if (iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error('Firebase ID token issuer mismatch');
  }
  if (!uid || uid.length > 128) throw new Error('Firebase ID token subject is invalid');

  return {
    uid,
    email: stringField(payload.email),
    name: stringField(payload.name),
    picture: stringField(payload.picture),
  };
}

function parseJwtPart(part: string): Record<string, unknown> {
  try {
    const decoded = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as unknown;
    if (decoded && typeof decoded === 'object') {
      return decoded as Record<string, unknown>;
    }
  } catch {
    // Fall through to the shared error.
  }
  throw new Error('Malformed Firebase ID token');
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function numberField(value: unknown): number | undefined {
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

async function getFirebasePublicCerts(): Promise<Record<string, string>> {
  if (certCache && certCache.expiresAt > Date.now()) return certCache.certs;

  const response = await fetch(FIREBASE_CERTS_URL);
  if (!response.ok) throw new Error('Unable to load Firebase public certificates');

  const raw = (await response.json()) as unknown;
  if (!raw || typeof raw !== 'object') {
    throw new Error('Firebase public certificates response is invalid');
  }

  const certs = Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter((entry): entry is [string, string] => {
      const [kid, certValue] = entry;
      return kid.trim().length > 0 && typeof certValue === 'string';
    }),
  );
  if (Object.keys(certs).length === 0) {
    throw new Error('Firebase public certificates response is empty');
  }

  const cacheControl = response.headers.get('cache-control') ?? '';
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/)?.[1] ?? 3600);
  certCache = {
    certs,
    expiresAt: Date.now() + Math.max(60, maxAge) * 1000,
  };
  return certs;
}
