import { env } from '@/config/env';
import { BookingItem } from '@/models/BookingItem.model';
import { PayoutRequest } from '@/models/PayoutRequest.model';
import { User } from '@/models/User.model';

type ActivityType = 'booking' | 'review' | 'payout' | 'system';
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

function formatUsd(value: number): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(Math.round(value));
  } catch {
    return `$${Math.round(value).toLocaleString('en-US')}`;
  }
}

function itemStatus(value: unknown): 'pending' | 'confirmed' | 'completed' | 'cancelled' {
  if (typeof value !== 'string') return 'pending';
  const raw = value.trim().toUpperCase();
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

export async function getProviderDashboard(): Promise<ProviderDashboardResponse> {
  const providerId = env.demoProviderId;
  const [items, payouts, user] = await Promise.all([
    BookingItem.find({ provider_id: providerId }).sort({ created_at: -1, _id: -1 }).lean(),
    PayoutRequest.find({ provider_id: providerId }).sort({ requested_at: -1, _id: -1 }).lean(),
    User.findById(providerId).lean(),
  ]);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  let totalRevenue = 0;
  let monthToDate = 0;
  const counts = { pending: 0, confirmed: 0, completed: 0, cancelled: 0 };
  for (const item of items) {
    const status = itemStatus(item.item_status);
    counts[status] += 1;
    if (status === 'confirmed' || status === 'completed') {
      totalRevenue += amount(item);
      const created = new Date(item.created_at ?? '1970-01-01').getTime();
      if (!Number.isNaN(created) && created >= monthStart) {
        monthToDate += amount(item);
      }
    }
  }

  const payoutsPending = payouts
    .filter((row) =>
      ['PENDING', 'SCHEDULED'].includes((row.status ?? '').toUpperCase()),
    )
    .reduce((sum, row) => sum + (row.amount ?? 0), 0);

  const latestActivities: RecentActivity[] = [
    ...items.slice(0, 4).map((item): RecentActivityWithTs => {
      const status = itemStatus(item.item_status);
      const activityTime = item.created_at ?? item.updated_at;
      const ts = activityTime ? new Date(activityTime).getTime() : 0;
      return {
        id: item._id,
        type: 'booking' as const,
        title:
          status === 'pending'
            ? 'New booking request'
            : status === 'completed'
              ? 'Booking completed'
              : 'Booking updated',
        subtitle: `Booking ${item.booking_id} • status ${status.toUpperCase()}`,
        timeLabel: relativeTime(activityTime),
        amountLabel: formatUsd(amount(item)),
        amountTone:
          status === 'cancelled'
            ? 'negative'
            : status === 'pending'
              ? 'neutral'
              : 'positive',
        ts: Number.isNaN(ts) ? 0 : ts,
      };
    }),
    ...payouts.slice(0, 2).map((row): RecentActivityWithTs => {
      const ts = row.requested_at ? new Date(row.requested_at).getTime() : 0;
      return {
      id: row._id,
      type: 'payout' as const,
      title: 'Payout requested',
      subtitle: `Status: ${(row.status ?? 'PENDING').toUpperCase()}`,
      timeLabel: relativeTime(row.requested_at),
      amountLabel: formatUsd(row.amount ?? 0),
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
      totalRevenueLabel: formatUsd(totalRevenue),
      monthToDate,
      monthToDateLabel: formatUsd(monthToDate),
      payoutsPending,
      payoutsPendingLabel: formatUsd(payoutsPending),
      deltaLabel: '+12.5% this month',
    },
    orderStatus: counts,
    recentActivities: latestActivities,
  };
}
