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
  subscription: {
    isElite: boolean;
    expiresAt: string | null;
    autoRenew: boolean;
    daysRemaining: number | null;
    expiresSoon: boolean;
  };
}

const HERO_IMAGE =
  'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80';
const ELITE_UPGRADE_PRICE_USD = 100;
const ELITE_PLAN_DURATION_DAYS = 30;

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

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function dateString(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' && value.trim() ? value : null;
}

function daysUntil(value: string | null, now = new Date()): number | null {
  if (!value) return null;
  const expiresAt = new Date(value);
  if (Number.isNaN(expiresAt.getTime())) return null;
  return Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / 86_400_000));
}

async function ensureVipExpiry(
  providerId: string,
  providerData: Record<string, unknown>,
): Promise<string | null> {
  const existingExpiry = dateString(providerData.vip_expires_at);
  if (existingExpiry) return existingExpiry;

  const expiresAt = addDays(new Date(), ELITE_PLAN_DURATION_DAYS).toISOString();
  const now = new Date().toISOString();

  await Provider.updateOne(
    { _id: providerId },
    {
      $set: {
        vip_expires_at: expiresAt,
        vip_auto_renew: providerData.vip_auto_renew !== false,
        updated_at: now,
      },
    },
  );
  return expiresAt;
}

async function maybeNotifyVipExpiringSoon(
  userId: string,
  providerId: string,
  providerData: Record<string, unknown>,
  expiresAt: string | null,
  remainingDays: number | null,
) {
  if (!expiresAt || remainingDays !== 1) return;

  if (providerData.vip_expiry_notice_for === expiresAt) return;

  const now = new Date().toISOString();
  await Promise.all([
    Provider.updateOne(
      { _id: providerId },
      {
        $set: {
          vip_expiry_notice_for: expiresAt,
          vip_expiry_notice_sent_at: now,
          updated_at: now,
        },
      },
    ),
    createNotification({
      userId,
      type: 'SYSTEM',
      title: 'Elite plan expires tomorrow',
      body: 'Your VIP Elite plan has 1 day remaining. Turn on auto-renew to keep your search priority active.',
      actionRoute: '/vip_services',
    }),
  ]);
}

export async function getProviderVip(userId: string): Promise<ProviderVipResponse> {
  const provider = await resolveProviderForUser(userId);
  const providerId = provider._id;
  const providerData = (provider as Record<string, unknown> | null) ?? {};
  const providerFilter = { provider_id: providerId };
  const isElite = String(provider?.status ?? '').toUpperCase() === 'ELITE';
  const expiresAt = isElite ? await ensureVipExpiry(providerId, providerData) : null;
  const autoRenew = providerData.vip_auto_renew !== false;
  const daysRemaining = isElite ? daysUntil(expiresAt) : null;
  const expiresSoon = isElite && daysRemaining === 1;
  const selectedPromotionIds = new Set(
    (
      (providerData.vip_promotions as Array<Record<string, unknown>> | null) ?? []
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

  await maybeNotifyVipExpiringSoon(userId, providerId, providerData, expiresAt, daysRemaining);

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
        priceLabel: `$${ELITE_UPGRADE_PRICE_USD.toLocaleString('en-US')}`,
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
    subscription: {
      isElite,
      expiresAt,
      autoRenew,
      daysRemaining,
      expiresSoon,
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
  if ((wallet.balance ?? 0) < ELITE_UPGRADE_PRICE_USD) {
    throw new ProviderVipError(400, 'Wallet has insufficient funds');
  }

  const now = new Date().toISOString();
  const expiresAt = addDays(new Date(), ELITE_PLAN_DURATION_DAYS).toISOString();
  wallet.balance = (wallet.balance ?? 0) - ELITE_UPGRADE_PRICE_USD;
  wallet.updated_at = now;

  await Provider.updateOne(
    { _id: provider._id },
    {
      $set: {
        status: 'ELITE',
        vip_plan: 'elite',
        vip_upgraded_at: now,
        vip_expires_at: expiresAt,
        vip_auto_renew: true,
        vip_expiry_notice_for: null,
        vip_expiry_notice_sent_at: null,
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
      amount: ELITE_UPGRADE_PRICE_USD,
      card_id: 'wallet',
      card_last4: null,
      status: 'SUCCESS',
      created_at: now,
    }),
    createNotification({
      userId,
      type: 'SYSTEM',
      title: 'Elite plan activated',
      body: `$${ELITE_UPGRADE_PRICE_USD.toLocaleString('en-US')} was charged from your wallet. Your plan is active until ${expiresAt.slice(0, 10)}.`,
      actionRoute: '/vip_services',
    }),
  ]);

  return getProviderVip(userId);
}

export async function updateProviderVipAutoRenew(
  userId: string,
  autoRenew: unknown,
): Promise<ProviderVipResponse> {
  if (typeof autoRenew !== 'boolean') {
    throw new ProviderVipError(400, 'autoRenew must be a boolean');
  }

  const provider = await ensureProvider(userId);
  const currentStatus = String(provider.status ?? '').toUpperCase();
  if (currentStatus !== 'ELITE') {
    throw new ProviderVipError(400, 'Elite plan is not active');
  }

  const now = new Date().toISOString();
  await Provider.updateOne(
    { _id: provider._id },
    {
      $set: {
        vip_auto_renew: autoRenew,
        updated_at: now,
      },
    },
  );

  await createNotification({
    userId,
    type: 'SYSTEM',
    title: autoRenew ? 'VIP auto-renew enabled' : 'VIP auto-renew disabled',
    body: autoRenew
      ? 'Your Elite plan will renew automatically when the current period ends.'
      : 'Your Elite plan will stop at the end of the current period unless you renew it manually.',
    actionRoute: '/vip_services',
  });

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
  const providerData = provider.toObject() as Record<string, unknown>;
  const selectedPromotionIds = new Set(
    (
      (providerData.vip_promotions as Array<Record<string, unknown>> | null) ?? []
    )
      .map((item) => item.promotion_id)
      .filter((id): id is string => typeof id === 'string'),
  );
  const now = new Date().toISOString();

  if (selectedPromotionIds.has(promotionId)) {
    await Provider.updateOne(
      { _id: provider._id },
      {
        $pull: {
          vip_promotions: {
            promotion_id: promotionId,
          },
        },
        $set: { updated_at: now },
      },
    );
    return getProviderVip(userId);
  }

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
