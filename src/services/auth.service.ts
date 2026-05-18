import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { AuthSession } from '@/models/AuthSession.model';
import { Provider } from '@/models/Provider.model';
import { User, type UserDoc } from '@/models/User.model';
import { Wallet } from '@/models/Wallet.model';
import { env } from '@/config/env';
import { getFirebaseAuthOrNull } from '@/config/firebase';

const MIN_PASSWORD_LENGTH = 8;
const PASSWORD_KEY_LENGTH = 64;
const AUTH_ROLES = ['PLANNER', 'PROVIDER'] as const;
type AuthRole = (typeof AUTH_ROLES)[number];

export interface PublicAuthUser {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  image: string | null;
  role: string;
  status: string;
}

export interface AuthPayload {
  user: PublicAuthUser;
  session: {
    token: string;
    expiresAt: string;
    ttlDays: number;
  };
}

export interface AuthSessionSnapshot {
  user: PublicAuthUser;
  session: {
    expiresAt: string;
    ttlDays: number;
  };
}

export interface AuthRequestContext {
  userAgent?: string | null;
}

export class AuthError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function assertEmail(email: string): void {
  if (!email || !email.includes('@') || email.length < 5) {
    throw new AuthError(400, 'Please enter a valid email address');
  }
}

function assertPassword(password: unknown): string {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new AuthError(
      400,
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }
  return password;
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, PASSWORD_KEY_LENGTH).toString('hex');
}

function passwordMatches(
  password: string,
  expectedHash: string,
  salt: string,
): boolean {
  const actualBuffer = Buffer.from(hashPassword(password, salt), 'hex');
  const expectedBuffer = Buffer.from(expectedHash, 'hex');
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function newExpiryDate(): Date {
  return new Date(Date.now() + env.authSessionTtlDays * 86_400_000);
}

function normalizeStoredRole(role: unknown): AuthRole {
  const normalized =
    typeof role === 'string' ? role.trim().toUpperCase() : 'PLANNER';
  if (normalized === 'PROVIDER') return 'PROVIDER';
  if (normalized === 'USER') return 'PLANNER';
  return 'PLANNER';
}

function mapUser(user: Partial<UserDoc> & { _id: string }): PublicAuthUser {
  return {
    id: user._id,
    fullName: user.full_name?.trim() || 'Tripwise Traveler',
    email: user.email ?? null,
    phone: user.phone ?? null,
    image: user.image ?? null,
    role: normalizeStoredRole(user.role),
    status: user.status?.trim() || 'ACTIVE',
  };
}

async function findUserByEmail(emailNormalized: string) {
  return User.findOne({
    $or: [
      { email_normalized: emailNormalized },
      { email: emailNormalized },
    ],
  })
    .collation({ locale: 'en', strength: 2 })
    .lean();
}

async function findUserByFirebaseUid(firebaseUid: string) {
  return User.findOne({ firebase_uid: firebaseUid }).lean();
}

async function ensureUserWallet(userId: string): Promise<void> {
  const existing = await Wallet.findOne({ user_id: userId }).lean();
  if (existing) return;
  const now = new Date().toISOString();
  await Wallet.create({
    _id: `wallet-${userId}`,
    user_id: userId,
    balance: 0,
    loyalty_points: 0,
    created_at: now,
    updated_at: now,
  });
}

async function ensureProviderProfile(
  userId: string,
  displayName: string,
): Promise<void> {
  const existing = await Provider.findOne({
    $or: [{ _id: userId }, { user_id: userId }],
  }).lean();
  if (existing) return;

  await Provider.create({
    _id: userId,
    user_id: userId,
    business_name: displayName,
    status: 'PENDING',
  });
}

async function createSession(
  userId: string,
  context?: AuthRequestContext,
): Promise<AuthPayload['session']> {
  const rawToken = randomBytes(48).toString('base64url');
  const sessionId = hashToken(rawToken);
  const now = new Date();
  const expiresAt = newExpiryDate();

  await AuthSession.create({
    _id: sessionId,
    user_id: userId,
    expires_at: expiresAt,
    created_at: now,
    last_used_at: now,
    user_agent: context?.userAgent?.trim() || null,
  });

  return {
    token: rawToken,
    expiresAt: expiresAt.toISOString(),
    ttlDays: env.authSessionTtlDays,
  };
}

export async function registerUser(
  body: unknown,
  context?: AuthRequestContext,
): Promise<AuthPayload> {
  const input = (body ?? {}) as Record<string, unknown>;
  const fullName = normalizeName(input.fullName ?? input.name);
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const password = assertPassword(input.password);

  if (!fullName) {
    throw new AuthError(400, 'Please enter your full name');
  }
  assertEmail(email);

  const existing = await findUserByEmail(email);
  if (existing) {
    throw new AuthError(409, 'An account with this email already exists');
  }

  const userId = randomUUID();
  const salt = randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);

  await User.create({
    _id: userId,
    full_name: fullName,
    email,
    email_normalized: email,
    phone,
    image: null,
    role: 'PLANNER',
    status: 'ACTIVE',
    auth_provider: 'local',
    password_hash: passwordHash,
    password_salt: salt,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  await Promise.all([
    ensureUserWallet(userId),
  ]);

  const user = await User.findById(userId).lean();
  if (!user) {
    throw new AuthError(500, 'Unable to create account');
  }

  return {
    user: mapUser(user),
    session: await createSession(userId, context),
  };
}

export async function loginUser(
  body: unknown,
  context?: AuthRequestContext,
): Promise<AuthPayload> {
  const input = (body ?? {}) as Record<string, unknown>;
  const email = normalizeEmail(input.email);
  const password = assertPassword(input.password);
  assertEmail(email);

  const user = await findUserByEmail(email);
  if (!user) {
    throw new AuthError(401, 'Invalid email or password');
  }

  const passwordHash =
    typeof user.password_hash === 'string' ? user.password_hash : null;
  const passwordSalt =
    typeof user.password_salt === 'string' ? user.password_salt : null;

  if (!passwordHash || !passwordSalt) {
    throw new AuthError(
      401,
      'This account cannot sign in with a password yet',
    );
  }

  if (!passwordMatches(password, passwordHash, passwordSalt)) {
    throw new AuthError(401, 'Invalid email or password');
  }
  const storedRole = normalizeStoredRole(user.role);

  const now = new Date().toISOString();
  await Promise.all([
    ensureUserWallet(user._id),
    storedRole === 'PROVIDER'
        ? ensureProviderProfile(
            user._id,
            user.full_name?.trim() || 'Tripwise Provider',
          )
        : Promise.resolve(),
    User.updateOne({ _id: user._id }, { $set: { last_login_at: now, updated_at: now } }),
  ]);

  return {
    user: mapUser(user),
    session: await createSession(user._id, context),
  };
}

export async function loginWithGoogleIdToken(
  body: unknown,
  context?: AuthRequestContext,
): Promise<AuthPayload> {
  const input = (body ?? {}) as Record<string, unknown>;
  const idToken =
    typeof input.idToken === 'string' ? input.idToken.trim() : '';
  if (!idToken) {
    throw new AuthError(400, 'Google ID token is required');
  }

  const firebaseAuth = getFirebaseAuthOrNull();
  if (!firebaseAuth) {
    throw new AuthError(
      503,
      'Google sign-in is not configured on the server yet',
    );
  }

  let decoded;
  try {
    decoded = await firebaseAuth.verifyIdToken(idToken);
  } catch {
    throw new AuthError(401, 'Google sign-in token is invalid or expired');
  }

  const email = normalizeEmail(decoded.email);
  if (!email) {
    throw new AuthError(400, 'Google account did not provide an email');
  }

  const firebaseUid = decoded.uid;
  const googleName = normalizeName(decoded.name) || 'Tripwise Traveler';
  const googlePicture =
    typeof decoded.picture === 'string' && decoded.picture.trim().length > 0
      ? decoded.picture.trim()
      : null;
  const now = new Date().toISOString();

  let user = await findUserByFirebaseUid(firebaseUid);
  if (!user) {
    user = await findUserByEmail(email);
  }

  if (!user) {
    const userId = randomUUID();
    await User.create({
      _id: userId,
      full_name: googleName,
      email,
      email_normalized: email,
      firebase_uid: firebaseUid,
      image: googlePicture,
      role: 'PLANNER',
      status: 'ACTIVE',
      auth_provider: 'google',
      created_at: now,
      updated_at: now,
      last_login_at: now,
    });
    await Promise.all([
      ensureUserWallet(userId),
    ]);
    user = await User.findById(userId).lean();
  } else {
    const storedRole = normalizeStoredRole(user.role);
    await Promise.all([
      ensureUserWallet(user._id),
      storedRole === 'PROVIDER'
          ? ensureProviderProfile(
              user._id,
              user.full_name?.trim() || googleName,
            )
          : Promise.resolve(),
      User.updateOne(
        { _id: user._id },
        {
          $set: {
            email,
            email_normalized: email,
            firebase_uid: firebaseUid,
            auth_provider: 'google',
            updated_at: now,
            last_login_at: now,
            ...(googlePicture != null ? { image: googlePicture } : {}),
            ...(user.full_name?.trim() ? {} : { full_name: googleName }),
          },
        },
      ),
    ]);
    user = await User.findById(user._id).lean();
  }

  if (!user) {
    throw new AuthError(500, 'Unable to complete Google sign-in');
  }

  return {
    user: mapUser(user),
    session: await createSession(user._id, context),
  };
}

export async function resolveAuthToken(token: string): Promise<{
  userId: string;
  sessionId: string;
  expiresAt: string;
  role: AuthRole;
} | null> {
  const rawToken = token.trim();
  if (!rawToken) return null;

  const sessionId = hashToken(rawToken);
  const session = await AuthSession.findById(sessionId).lean();
  if (!session) return null;

  const expiresAtDate = new Date(session.expires_at);
  if (Number.isNaN(expiresAtDate.getTime()) || expiresAtDate.getTime() <= Date.now()) {
    await AuthSession.deleteOne({ _id: sessionId });
    return null;
  }

  const user = await User.findById(session.user_id)
    .select({ _id: 1, role: 1 })
    .lean();
  if (!user) {
    await AuthSession.deleteOne({ _id: sessionId });
    return null;
  }

  await AuthSession.updateOne(
    { _id: sessionId },
    { $set: { last_used_at: new Date() } },
  );

  return {
    userId: session.user_id,
    sessionId,
    expiresAt: expiresAtDate.toISOString(),
    role: normalizeStoredRole(user.role),
  };
}

export async function getCurrentSession(
  userId: string,
  expiresAt: string,
): Promise<AuthSessionSnapshot> {
  const user = await User.findById(userId).lean();
  if (!user) {
    throw new AuthError(404, 'User not found');
  }
  return {
    user: mapUser(user),
    session: {
      expiresAt,
      ttlDays: env.authSessionTtlDays,
    },
  };
}

export async function logoutSession(sessionId: string): Promise<void> {
  await AuthSession.deleteOne({ _id: sessionId });
}
