import { Hotel } from '@/models/Hotel.model';
import { Room } from '@/models/Room.model';
import { RoomInventory } from '@/models/RoomInventory.model';
import { env } from '@/config/env';

// No dynamic-pricing-rule or analytics data exists in the DB, so these are
// server-side config / derived for the slice. Adjust freely; not persisted.
const PRICING_RULES = [
  { label: 'Weekend Surge', value: '+20%', tone: 'secondary' as const },
  { label: 'Holiday Peak', value: '+35%', tone: 'secondary' as const },
  { label: 'Last Minute Disc.', value: '-10%', tone: 'primary' as const },
];

// Proxy until a real period-over-period query exists (needs bookings history).
const REVENUE_DELTA_LABEL = '12% from last month';

export type DayStatus = 'available' | 'highPrice' | 'closed';

export interface InventoryDay {
  day: number;
  date: string;
  price: number;
  status: DayStatus;
  availableQty: number;
}

export interface InventoryOverviewResponse {
  listing: {
    roomId: number;
    roomType: string;
    hotelId: number;
    hotelName: string;
    basePrice: number;
  };
  currency: string;
  month: string;
  monthLabel: string;
  leadingBlanks: number;
  days: InventoryDay[];
  pricingRules: typeof PRICING_RULES;
  analytics: {
    occupancyPct: number;
    revenueForecast: number;
    revenueDeltaLabel: string;
    demandLevel: 'High' | 'Medium' | 'Low';
    demandNote: string;
  };
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Parse a `YYYY-MM` param; fall back to the current month if absent/invalid. */
function resolveMonth(monthParam?: string): { year: number; monthIdx: number } {
  if (monthParam && /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam)) {
    const [y, m] = monthParam.split('-').map(Number);
    return { year: y, monthIdx: m - 1 };
  }
  const now = new Date();
  return { year: now.getFullYear(), monthIdx: now.getMonth() };
}

function demandFor(avgQty: number): { level: 'High' | 'Medium' | 'Low'; note: string } {
  if (avgQty >= 15) {
    return {
      level: 'High',
      note: 'Demand for rentals in your area is trending high for the upcoming season.',
    };
  }
  if (avgQty >= 7) {
    return {
      level: 'Medium',
      note: 'Demand in your area is steady — consider light surge pricing on weekends.',
    };
  }
  return {
    level: 'Low',
    note: 'Demand is soft this period — discounts may help fill open dates.',
  };
}

export async function getInventoryOverview(
  monthParam?: string,
): Promise<InventoryOverviewResponse | null> {
  const providerId = env.demoProviderId;

  const hotels = await Hotel.find({
    provider_id: providerId,
    deleted_at: null,
  }).lean();
  if (hotels.length === 0) return null;

  const hotelIds = hotels.map((h) => h._id);
  const hotelName = new Map(hotels.map((h) => [h._id, h.name]));

  // The screen shows a single listing; pick this provider's first room.
  const room = await Room.findOne({
    hotel_id: { $in: hotelIds },
    deleted_at: null,
  })
    .sort({ _id: 1 })
    .lean();
  if (!room) return null;

  const basePrice = room.base_price ?? 0;
  const { year, monthIdx } = resolveMonth(monthParam);
  const monthStr = `${year}-${pad2(monthIdx + 1)}`;
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const monthStart = `${monthStr}-01`;
  const monthEnd = `${monthStr}-${pad2(daysInMonth)}`;
  // Monday-based offset so the grid aligns under the MON…SUN header.
  const leadingBlanks = (new Date(year, monthIdx, 1).getDay() + 6) % 7;
  const monthLabel = new Date(year, monthIdx, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const rows = await RoomInventory.find({
    room_id: room._id,
    date: { $gte: monthStart, $lte: monthEnd },
  }).lean();
  const byDate = new Map(rows.map((r) => [r.date, r]));

  const days: InventoryDay[] = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${monthStr}-${pad2(d)}`;
    const row = byDate.get(date);
    const qty = row?.available_qty ?? 0;
    const price =
      row && row.price_override != null ? row.price_override : basePrice;
    let status: DayStatus;
    if (!row || qty <= 0) {
      status = 'closed';
    } else if (price > basePrice) {
      status = 'highPrice';
    } else {
      status = 'available';
    }
    days.push({ day: d, date, price, status, availableQty: qty });
  }

  const openDays = days.filter((x) => x.status !== 'closed');
  const occupancyPct =
    daysInMonth > 0 ? Math.round((openDays.length / daysInMonth) * 100) : 0;
  const revenueForecast = openDays.reduce((sum, x) => sum + x.price, 0);
  const avgQty =
    openDays.length > 0
      ? openDays.reduce((sum, x) => sum + x.availableQty, 0) / openDays.length
      : 0;
  const demand = demandFor(avgQty);

  return {
    listing: {
      roomId: room._id,
      roomType: room.room_type ?? 'Room',
      hotelId: room.hotel_id,
      hotelName: hotelName.get(room.hotel_id) ?? 'Listing',
      basePrice,
    },
    currency: 'VND',
    month: monthStr,
    monthLabel,
    leadingBlanks,
    days,
    pricingRules: PRICING_RULES,
    analytics: {
      occupancyPct,
      revenueForecast: Math.round(revenueForecast),
      revenueDeltaLabel: REVENUE_DELTA_LABEL,
      demandLevel: demand.level,
      demandNote: demand.note,
    },
  };
}
