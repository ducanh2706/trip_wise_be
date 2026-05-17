import { env } from '@/config/env';
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

export async function getProfile(): Promise<ProfileResponse> {
  const userId = env.demoUserId;
  await ensureVerification(userId);

  const [user, wallet, trips, verification, provider] = await Promise.all([
    User.findById(userId).lean(),
    Wallet.findOne({ user_id: userId }).lean(),
    Trip.find({ user_id: userId }).select({ destination: 1 }).lean(),
    ProfileVerification.findById(userId).lean(),
    Provider.findById(env.demoProviderId).lean(),
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
