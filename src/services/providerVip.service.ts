import { randomUUID } from 'node:crypto';
import { BookingItem } from '@/models/BookingItem.model';
import { Hotel } from '@/models/Hotel.model';
import { Provider } from '@/models/Provider.model';
import { User } from '@/models/User.model';
import { Wallet } from '@/models/Wallet.model';
import { WalletTx } from '@/models/WalletTransaction.model';
import { createNotification } from '@/services/notifications.service';
import { resolveProviderForUser } from '@/services/providerAccess.service';

export interface ProviderVipResponse {
  hero: {
    badge: string;
    title: string;
    description: string;
    imageUrl: string;
  };
  plans: Array<{
    id: 'standard' | 'elite';
    name: string;
    description: string;
    isCurrent: boolean;
    features: string[];
    stats: Array<{ value: string; label: string }>;
    priceLabel: string;
    priceUnit: string;
    ctaLabel: string;
    ctaRoute: string | null;
  }>;
  promotions: Array<{
    id: string;
    icon: string;
    title: string;
    description: string;
    imageUrl: string;
    priceLabel: string;
    priceUnit: string;
    isSelected: boolean;
  }>;
  impact: {
    reachIncreasePct: number;
    bookingVelocityLabel: string;
  };
}

const HERO_IMAGE =
  'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80';
const ELITE_UPGRADE_PRICE_VND = 2_499_000;

const PROMOTIONS = [
  {
    id: 'top_search',
    icon: 'rocket',
    title: 'Top of Search',
    description: 'Guarantee your listing appears in the first 3 results for your destination city.',
    imageUrl:
      'https://images.unsplash.com/photo-1551434678-e076c223a692?auto=format&fit=crop&w=900&q=80',
    priceLabel: '$12',
    priceUnit: '/ Day',
  },
  {
    id: 'featured_slots',
    icon: 'featured',
    title: 'Featured Slots',
    description: "Get showcased in our 'Weekly Inspirations' email sent to 1.2M active users.",
    imageUrl:
      'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80',
    priceLabel: '$79',
    priceUnit: '/ Week',
  },
  {
    id: 'social_push',
    icon: 'campaign',
    title: 'Social Push',
    description: 'Exclusive feature on Tripwise Instagram and TikTok partner networks.',
    imageUrl:
      'https://images.unsplash.com/photo-1611162617474-5b21e879e113?auto=format&fit=crop&w=900&q=80',
    priceLabel: '$149',
    priceUnit: '/ Post',
  },
];

async function ensureProvider(userId: string) {
  const existing = await Provider.findOne({
    $or: [{ _id: userId }, { user_id: userId }],
  });
  if (existing) return existing;

  const user = await User.findById(userId).lean();
  const now = new Date().toISOString();
  return Provider.create({
    _id: userId,
    user_id: userId,
    business_name: user?.full_name?.trim() || 'Tripwise Provider',
    status: 'STANDARD',
    created_at: now,
    updated_at: now,
  } as Record<string, unknown>);
}

export async function getProviderVip(userId: string): Promise<ProviderVipResponse> {
  const provider = await resolveProviderForUser(userId);
  const providerId = provider._id;
  const providerFilter = { provider_id: providerId };
  const isElite = String(provider?.status ?? '').toUpperCase() === 'ELITE';
  const selectedPromotionIds = new Set(
    (
      ((provider as Record<string, unknown> | null)?.vip_promotions as Array<
        Record<string, unknown>
      > | null) ?? []
    )
      .map((item) => item.promotion_id)
      .filter((id): id is string => typeof id === 'string'),
  );

  const [listingCount, confirmedBookings] = await Promise.all([
    Hotel.countDocuments({ ...providerFilter, deleted_at: null }),
    BookingItem.countDocuments({
      ...providerFilter,
      item_status: { $in: ['CONFIRMED', 'PAID', 'ACCEPTED', 'APPROVED', 'COMPLETED', 'DONE'] },
    }),
  ]);

  const reachIncreasePct = Math.min(92, Math.max(32, 48 + listingCount * 4));
  const bookingVelocity = Math.min(5.0, Math.max(1.4, 1.5 + confirmedBookings / 25));

  return {
    hero: {
      badge: 'VIP SERVICES',
      title: 'Elevate Your Presence.',
      description:
        'Unlock premium tools, lower your commission rates, and feature your services to millions of global travelers.',
      imageUrl: HERO_IMAGE,
    },
    plans: [
      {
        id: 'standard',
        name: 'Standard Provider',
        description: 'Your current operational baseline.',
        isCurrent: !isElite,
        features: ['15% Platform Commission', 'Standard Support (24h)', 'Basic Analytics'],
        stats: [],
        priceLabel: '',
        priceUnit: '',
        ctaLabel: isElite ? 'Available Plan' : 'Current Active Plan',
        ctaRoute: null,
      },
      {
        id: 'elite',
        name: 'ELITE PROVIDER',
        description: 'The gold standard for high-volume agencies and luxury boutiques.',
        isCurrent: isElite,
        features: [],
        stats: [
          { value: '8%', label: 'Reduced Commission' },
          { value: '24/7', label: 'Dedicated Concierge' },
          { value: 'Verified', label: 'Premium Badge' },
          { value: 'Priority', label: 'Search Placement' },
        ],
        priceLabel: `₫${ELITE_UPGRADE_PRICE_VND.toLocaleString('en-US')}`,
        priceUnit: '/mo',
        ctaLabel: isElite ? 'CURRENT ELITE PLAN' : 'UPGRADE NOW',
        ctaRoute: isElite ? null : '/elite_upgrade_confirmation',
      },
    ],
    promotions: PROMOTIONS.map((promotion) => ({
      ...promotion,
      isSelected: selectedPromotionIds.has(promotion.id),
    })),
    impact: {
      reachIncreasePct,
      bookingVelocityLabel: `${bookingVelocity.toFixed(1)}x`,
    },
  };
}

export async function upgradeProviderToElite(userId: string): Promise<ProviderVipResponse> {
  const provider = await ensureProvider(userId);
  const currentStatus = String(provider.status ?? '').toUpperCase();
  if (currentStatus === 'ELITE') {
    return getProviderVip(userId);
  }

  const wallet = await Wallet.findOne({ user_id: userId });
  if (!wallet) {
    throw new ProviderVipError(404, 'Wallet not found');
  }
  if ((wallet.balance ?? 0) < ELITE_UPGRADE_PRICE_VND) {
    throw new ProviderVipError(400, 'Wallet has insufficient funds');
  }

  const now = new Date().toISOString();
  wallet.balance = (wallet.balance ?? 0) - ELITE_UPGRADE_PRICE_VND;
  wallet.updated_at = now;

  await Provider.updateOne(
    { _id: provider._id },
    {
      $set: {
        status: 'ELITE',
        vip_plan: 'elite',
        vip_upgraded_at: now,
        updated_at: now,
      },
    },
  );

  await Promise.all([
    wallet.save(),
    WalletTx.create({
      _id: randomUUID(),
      user_id: userId,
      type: 'VIP_UPGRADE',
      amount: ELITE_UPGRADE_PRICE_VND,
      card_id: 'wallet',
      card_last4: null,
      status: 'SUCCESS',
      created_at: now,
    }),
    createNotification({
      userId,
      type: 'SYSTEM',
      title: 'Elite plan activated',
      body: `₫${ELITE_UPGRADE_PRICE_VND.toLocaleString('en-US')} was charged from your wallet.`,
      actionRoute: '/vip_services',
    }),
  ]);

  return getProviderVip(userId);
}

export class ProviderVipError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function selectProviderPromotion(
  userId: string,
  promotionId: unknown,
): Promise<ProviderVipResponse> {
  if (typeof promotionId !== 'string' || !PROMOTIONS.some((item) => item.id === promotionId)) {
    throw new ProviderVipError(400, 'Invalid promotion');
  }

  const provider = await ensureProvider(userId);
  const now = new Date().toISOString();
  await Provider.updateOne(
    { _id: provider._id },
    {
      $push: {
        vip_promotions: {
          promotion_id: promotionId,
          status: 'SELECTED',
          selected_at: now,
        },
      },
      $set: { updated_at: now },
    },
  );
  return getProviderVip(userId);
}
