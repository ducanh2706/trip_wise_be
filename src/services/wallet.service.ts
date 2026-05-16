import { Wallet } from '@/models/Wallet.model';
import { Payment } from '@/models/Payment.model';
import { User } from '@/models/User.model';
import { env } from '@/config/env';

// No loyalty-tier or points-rate data exists in the DB, so these are
// server-side config for the slice. Adjust freely; not persisted anywhere.
const POINT_VALUE_VND = 100;
const TIERS = [
  { name: 'SILVER', min: 0 },
  { name: 'GOLD', min: 5000 },
  { name: 'PLATINUM', min: 15000 },
];

export interface WalletTransaction {
  id: string;
  title: string;
  subtitle: string;
  method: string;
  amountVnd: number;
  status: string;
}

export interface WalletOverviewResponse {
  user: { id: string; name: string; image: string | null } | null;
  balance: number;
  currency: string;
  loyaltyPoints: number;
  pointsValueVnd: number;
  tier: {
    current: string;
    next: string | null;
    pointsToNext: number | null;
    progress: number;
  };
  transactions: WalletTransaction[];
}

function deriveTier(points: number): WalletOverviewResponse['tier'] {
  let idx = 0;
  for (let i = 0; i < TIERS.length; i++) {
    if (points >= TIERS[i].min) idx = i;
  }
  const current = TIERS[idx];
  const next = TIERS[idx + 1] ?? null;
  if (!next) {
    return { current: current.name, next: null, pointsToNext: null, progress: 1 };
  }
  const span = next.min - current.min;
  const into = points - current.min;
  return {
    current: current.name,
    next: next.name,
    pointsToNext: Math.max(next.min - points, 0),
    progress: span > 0 ? Math.min(Math.max(into / span, 0), 1) : 1,
  };
}

function formatDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function titleForMethod(method?: string | null): string {
  switch (method) {
    case 'VNPAY':
      return 'VNPAY payment';
    case 'MOMO':
      return 'MoMo payment';
    case 'CREDIT_CARD':
      return 'Card payment';
    case 'WALLET':
      return 'Wallet payment';
    case 'PAYLATER':
      return 'Pay Later';
    default:
      return 'Payment';
  }
}

export async function getWalletOverview(): Promise<WalletOverviewResponse | null> {
  const userId = env.demoUserId;
  const wallet = await Wallet.findOne({ user_id: userId }).lean();
  if (!wallet) return null;

  const [user, payments] = await Promise.all([
    User.findById(userId).lean(),
    Payment.find({ user_id: userId }).sort({ created_at: -1 }).limit(10).lean(),
  ]);

  const points = wallet.loyalty_points ?? 0;

  const transactions: WalletTransaction[] = payments.map((p) => {
    const ref = p.booking_id ? `Booking ${p.booking_id}` : 'Payment';
    const date = formatDate(p.created_at);
    return {
      id: p._id,
      title: titleForMethod(p.payment_method),
      subtitle: date ? `${ref} • ${date}` : ref,
      method: p.payment_method ?? 'UNKNOWN',
      amountVnd: -(p.amount ?? 0),
      status: p.status ?? 'UNKNOWN',
    };
  });

  return {
    user: user
      ? { id: user._id, name: user.full_name ?? 'Traveler', image: user.image ?? null }
      : null,
    balance: wallet.balance ?? 0,
    currency: 'VND',
    loyaltyPoints: points,
    pointsValueVnd: points * POINT_VALUE_VND,
    tier: deriveTier(points),
    transactions,
  };
}
