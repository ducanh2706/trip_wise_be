import { BookingItem } from '@/models/BookingItem.model';
import { Hotel } from '@/models/Hotel.model';
import { PayoutRequest } from '@/models/PayoutRequest.model';
import { User } from '@/models/User.model';
import { getProviderOrderCounts } from '@/services/orders.service';
import { resolveProviderForUser } from '@/services/providerAccess.service';

type ActivityType = 'booking' | 'listing' | 'review' | 'payout' | 'system';
type RecentActivity = ProviderDashboardResponse['recentActivities'][number];
type RecentActivityWithTs = RecentActivity & { ts: number };

export interface ProviderDashboardResponse {
  greeting: {
    providerName: string;
  };
  revenue: {
    totalRevenue: number;
    totalRevenueLabel: string;
    monthToDate: number;
    monthToDateLabel: string;
    payoutsPending: number;
    payoutsPendingLabel: string;
    deltaLabel: string;
  };
  orderStatus: {
    pending: number;
    confirmed: number;
    completed: number;
    cancelled: number;
  };
  recentActivities: Array<{
    id: string;
    type: ActivityType;
    title: string;
    subtitle: string;
    timeLabel: string;
    amountLabel: string | null;
    amountTone: 'positive' | 'neutral' | 'negative';
  }>;
}

function amount(item: { total_price?: number | null }): number {
  return typeof item.total_price === 'number' && Number.isFinite(item.total_price)
    ? item.total_price
    : 0;
}

function formatVnd(value: number): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    }).format(Math.round(value));
  } catch {
    return `$${Math.round(value).toLocaleString('en-US')}`;
  }
}

function formatDelta(current: number, previous: number): string {
  if (previous <= 0) {
    return current > 0 ? 'New this month' : 'No change this month';
  }
  const delta = ((current - previous) / previous) * 100;
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)}% this month`;
}

function itemStatus(value: unknown): 'pending' | 'confirmed' | 'completed' | 'cancelled' {
  if (typeof value !== 'string') return 'pending';
  const raw = value.trim().toUpperCase();
  if (['PENDING', 'REQUESTED', 'AWAITING_APPROVAL'].includes(raw)) return 'pending';
  if (['CONFIRMED', 'PAID', 'ACCEPTED', 'APPROVED'].includes(raw)) return 'confirmed';
  if (['COMPLETED', 'DONE'].includes(raw)) return 'completed';
  if (['CANCELLED', 'CANCELED', 'REJECTED'].includes(raw)) return 'cancelled';
  return 'pending';
}

function relativeTime(iso?: string | null): string {
  if (!iso) return 'just now';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'just now';
  const min = Math.floor((Date.now() - then) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function activityTimestamp(...values: Array<string | null | undefined>): number {
  for (const value of values) {
    if (!value) continue;
    const ts = new Date(value).getTime();
    if (!Number.isNaN(ts)) return ts;
  }
  return 0;
}

function bookingActivityTitle(status: ReturnType<typeof itemStatus>): string {
  if (status === 'pending') return 'New booking request';
  if (status === 'confirmed') return 'Booking accepted';
  if (status === 'completed') return 'Booking completed';
  return 'Booking canceled';
}

function listingActivityStatus(value: unknown): 'active' | 'pending' | 'inactive' {
  if (typeof value !== 'string') return 'active';
  const raw = value.trim().toUpperCase();
  if (['PENDING', 'PENDING_REVIEW'].includes(raw)) return 'pending';
  if (['INACTIVE', 'DELETED', 'REMOVED'].includes(raw)) return 'inactive';
  return 'active';
}

function listingActivityTitle(input: {
  createdAt?: string | null;
  updatedAt?: string | null;
  deletedAt?: string | null;
  status: 'active' | 'pending' | 'inactive';
}): string {
  if (input.deletedAt) return 'Listing removed';
  if (input.createdAt && input.updatedAt && input.createdAt === input.updatedAt) {
    return 'Listing added';
  }
  if (input.status === 'pending') return 'Listing pending review';
  if (input.status === 'inactive') return 'Listing paused';
  return 'Listing updated';
}

export async function getProviderDashboard(userId: string): Promise<ProviderDashboardResponse> {
  const provider = await resolveProviderForUser(userId);
  const providerId = provider._id;
  const providerFilter = { provider_id: providerId };
  const [items, payouts, listings, user, counts] = await Promise.all([
    BookingItem.find(providerFilter).sort({ updated_at: -1, created_at: -1, _id: -1 }).lean(),
    PayoutRequest.find(providerFilter).sort({ requested_at: -1, _id: -1 }).lean(),
    Hotel.find(providerFilter).sort({ updated_at: -1, created_at: -1, _id: -1 }).limit(8).lean(),
    User.findById(provider.user_id || userId).lean(),
    getProviderOrderCounts(providerId),
  ]);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();

  let totalRevenue = 0;
  let monthToDate = 0;
  let previousMonthToDate = 0;
  for (const item of items) {
    const status = itemStatus(item.item_status);
    if (status === 'confirmed' || status === 'completed') {
      totalRevenue += amount(item);
      const created = new Date(item.created_at ?? '1970-01-01').getTime();
      if (!Number.isNaN(created) && created >= monthStart) {
        monthToDate += amount(item);
      }
      if (!Number.isNaN(created) && created >= previousMonthStart && created < monthStart) {
        previousMonthToDate += amount(item);
      }
    }
  }

  const payoutsPending = payouts
    .filter((row) => ['PENDING', 'SCHEDULED'].includes((row.status ?? '').toUpperCase()))
    .reduce((sum, row) => sum + (row.amount ?? 0), 0);

  const latestActivities: RecentActivity[] = [
    ...items.slice(0, 8).map((item): RecentActivityWithTs => {
      const status = itemStatus(item.item_status);
      const activityTime = item.updated_at ?? item.created_at;
      const ts = activityTimestamp(item.updated_at, item.created_at);
      return {
        id: item._id,
        type: 'booking' as const,
        title: bookingActivityTitle(status),
        subtitle: `Booking ${item.booking_id} • ${status.toUpperCase()}`,
        timeLabel: relativeTime(activityTime),
        amountLabel: formatVnd(amount(item)),
        amountTone:
          status === 'cancelled' ? 'negative' : status === 'pending' ? 'neutral' : 'positive',
        ts: Number.isNaN(ts) ? 0 : ts,
      };
    }),
    ...listings.map((listing): RecentActivityWithTs => {
      const status = listingActivityStatus(listing.listing_status ?? listing.status);
      const activityTime = listing.deleted_at ?? listing.updated_at ?? listing.created_at;
      const ts = activityTimestamp(listing.deleted_at, listing.updated_at, listing.created_at);
      return {
        id: `listing-${listing._id}`,
        type: 'listing' as const,
        title: listingActivityTitle({
          createdAt: listing.created_at,
          updatedAt: listing.updated_at,
          deletedAt: listing.deleted_at,
          status,
        }),
        subtitle: `${listing.name ?? 'Untitled listing'} • ${status.toUpperCase()}`,
        timeLabel: relativeTime(activityTime),
        amountLabel: null,
        amountTone: status === 'inactive' ? 'negative' : 'neutral',
        ts,
      };
    }),
    ...payouts.slice(0, 2).map((row): RecentActivityWithTs => {
      const ts = activityTimestamp(row.requested_at, row.scheduled_for, row.paid_at);
      return {
        id: row._id,
        type: 'payout' as const,
        title: 'Payout requested',
        subtitle: `Status: ${(row.status ?? 'PENDING').toUpperCase()}`,
        timeLabel: relativeTime(row.requested_at),
        amountLabel: formatVnd(row.amount ?? 0),
        amountTone: 'negative' as const,
        ts: Number.isNaN(ts) ? 0 : ts,
      };
    }),
  ]
    .sort((left, right) => right.ts - left.ts)
    .slice(0, 6)
    .map(({ ts: _ts, ...activity }) => activity);

  return {
    greeting: {
      providerName: user?.full_name?.trim() || 'Provider',
    },
    revenue: {
      totalRevenue,
      totalRevenueLabel: formatVnd(totalRevenue),
      monthToDate,
      monthToDateLabel: formatVnd(monthToDate),
      payoutsPending,
      payoutsPendingLabel: formatVnd(payoutsPending),
      deltaLabel: formatDelta(monthToDate, previousMonthToDate),
    },
    orderStatus: counts,
    recentActivities: latestActivities,
  };
}
