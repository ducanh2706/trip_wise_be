import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ProfileVerification } from '@/models/ProfileVerification.model';
import { Provider } from '@/models/Provider.model';
import { Trip } from '@/models/Trip.model';
import { User } from '@/models/User.model';
import { Wallet } from '@/models/Wallet.model';

export interface ProfileResponse {
  user: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    image: string | null;
    tierLabel: string;
    countriesVisited: number;
  };
  provider: {
    isRegistered: boolean;
    ctaLabel: string;
    ctaRoute: string;
    dashboardRoute: string;
  };
  verification: {
    passportUploaded: boolean;
    passportNote: string;
    addressUploaded: boolean;
    addressNote: string;
    updatedAt: string | null;
  };
}

export interface UpdateAvatarResponse {
  imageUrl: string;
}

export class ProfileError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const AVATAR_DIR = path.resolve(process.cwd(), 'uploads/avatars');
const MAX_AVATAR_BYTES = 3 * 1024 * 1024;
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function deriveTier(points: number): string {
  if (points >= 15000) return 'Platinum Voyager';
  if (points >= 5000) return 'Gold Voyager';
  return 'Premium Voyager';
}

async function ensureVerification(userId: string): Promise<void> {
  const existing = await ProfileVerification.findById(userId).lean();
  if (existing) return;
  await ProfileVerification.create({
    _id: userId,
    passport_uploaded: false,
    passport_note: 'Not submitted',
    address_uploaded: false,
    address_note: 'Not submitted',
    updated_at: new Date().toISOString(),
  });
}

function destinationKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  return v.length > 0 ? v : null;
}

export async function getProfile(userId: string): Promise<ProfileResponse> {
  await ensureVerification(userId);

  const [user, wallet, trips, verification, provider] = await Promise.all([
    User.findById(userId).lean(),
    Wallet.findOne({ user_id: userId }).lean(),
    Trip.find({ user_id: userId }).select({ destination: 1 }).lean(),
    ProfileVerification.findById(userId).lean(),
    Provider.findOne({ $or: [{ user_id: userId }, { _id: userId }] }).lean(),
  ]);

  const visited = new Set<string>();
  for (const trip of trips) {
    const key = destinationKey(trip.destination);
    if (key) visited.add(key);
  }

  const points = wallet?.loyalty_points ?? 0;
  const displayName = user?.full_name?.trim() || 'Tripwise Traveler';

  return {
    user: {
      id: userId,
      name: displayName,
      email: user?.email ?? null,
      phone: user?.phone ?? null,
      image: user?.image ?? null,
      tierLabel: deriveTier(points),
      countriesVisited: Math.max(visited.size, 1),
    },
    provider: {
      isRegistered: Boolean(provider),
      ctaLabel: provider ? 'Open Provider Dashboard' : 'Start Registration',
      ctaRoute: provider ? '/provider_dashboard' : '/provider_registration_form',
      dashboardRoute: '/provider_dashboard',
    },
    verification: {
      passportUploaded: verification?.passport_uploaded ?? false,
      passportNote: verification?.passport_note ?? 'Not submitted',
      addressUploaded: verification?.address_uploaded ?? false,
      addressNote: verification?.address_note ?? 'Not submitted',
      updatedAt: verification?.updated_at ?? null,
    },
  };
}

function normalizeMimeType(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeFileName(value: unknown): string {
  if (typeof value !== 'string') return 'avatar';
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  return normalized.length > 0 ? normalized : 'avatar';
}

function normalizeBase64(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  const commaIdx = trimmed.indexOf(',');
  if (commaIdx > 0 && trimmed.slice(0, commaIdx).includes('base64')) {
    return trimmed.slice(commaIdx + 1).trim();
  }
  return trimmed;
}

export async function updateProfileAvatar(
  userId: string,
  body: unknown,
  publicBaseUrl: string,
): Promise<UpdateAvatarResponse> {
  const input = (body ?? {}) as Record<string, unknown>;
  const mimeType = normalizeMimeType(input.mimeType);
  const ext = MIME_TO_EXT[mimeType];
  if (!ext) {
    throw new ProfileError(400, 'Only JPG, PNG, WEBP images are supported');
  }

  const base64Data = normalizeBase64(input.dataBase64);
  if (!base64Data) {
    throw new ProfileError(400, 'Avatar data is required');
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64Data, 'base64');
  } catch {
    throw new ProfileError(400, 'Invalid avatar data');
  }

  if (!buffer.length) {
    throw new ProfileError(400, 'Avatar data is empty');
  }
  if (buffer.length > MAX_AVATAR_BYTES) {
    throw new ProfileError(413, 'Avatar exceeds 3MB limit');
  }

  const originalName = normalizeFileName(input.fileName);
  const now = Date.now();
  const fileName = `${userId}-${now}-${originalName}.${ext}`;
  const diskPath = path.join(AVATAR_DIR, fileName);
  const imagePath = `/uploads/avatars/${fileName}`;

  await mkdir(AVATAR_DIR, { recursive: true });
  await writeFile(diskPath, buffer);

  const imageUrl = `${publicBaseUrl}${imagePath}`;
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        image: imageUrl,
        updated_at: new Date().toISOString(),
      },
    },
  );

  return { imageUrl };
}
