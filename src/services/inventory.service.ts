import { Hotel } from '@/models/Hotel.model';
import { Room } from '@/models/Room.model';
import { RoomInventory } from '@/models/RoomInventory.model';
import { PricingRule } from '@/models/PricingRule.model';
import { env } from '@/config/env';

// Vietnam public holidays (only the data window 2026-05..07 is exercised, but
// the full year is listed so Holiday Peak is meaningful year-round). Adjust
// freely — self-contained, no external calendar dependency.
const HOLIDAYS = new Set<string>([
  '2026-01-01',
  '2026-02-16',
  '2026-02-17',
  '2026-02-18',
  '2026-02-19',
  '2026-02-20',
  '2026-04-30',
  '2026-05-01',
  '2026-09-01',
  '2026-09-02',
]);

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

export interface PricingRuleView {
  key: 'weekend' | 'holiday' | 'lastMinute';
  label: string;
  value: string;
  tone: 'primary' | 'secondary';
  percent: number;
  enabled: boolean;
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
  pricingRules: PricingRuleView[];
  analytics: {
    occupancyPct: number;
    revenueForecast: number;
    revenueDeltaLabel: string;
    demandLevel: 'High' | 'Medium' | 'Low';
    demandNote: string;
  };
}

/** A thrown error the controller maps to a 4xx instead of a 500. */
export class InventoryError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

function resolveMonth(monthParam?: string): { year: number; monthIdx: number } {
  if (monthParam && /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam)) {
    const [y, m] = monthParam.split('-').map(Number);
    return { year: y, monthIdx: m - 1 };
  }
  const now = new Date();
  return { year: now.getFullYear(), monthIdx: now.getMonth() };
}

function isWeekend(dateStr: string): boolean {
  const [y, m, d] = dateStr.split('-').map(Number);
  const g = new Date(y, m - 1, d).getDay();
  return g === 0 || g === 6;
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

interface RulesDoc {
  weekend_surge_pct: number;
  holiday_peak_pct: number;
  last_minute_disc_pct: number;
  last_minute_days: number;
  weekend_enabled: boolean;
  holiday_enabled: boolean;
  last_minute_enabled: boolean;
}

/** Idempotently fetch (or create with defaults) this provider's rule doc. */
async function ensurePricingRules(providerId: string) {
  let doc = await PricingRule.findById(providerId);
  if (!doc) {
    const now = new Date().toISOString();
    doc = await PricingRule.create({
      _id: providerId,
      created_at: now,
      updated_at: now,
    });
  }
  return doc;
}

function rulesViews(r: RulesDoc): PricingRuleView[] {
  const fmt = (n: number) => `${n >= 0 ? '+' : ''}${n}%`;
  return [
    {
      key: 'weekend',
      label: 'Weekend Surge',
      percent: r.weekend_surge_pct,
      value: fmt(r.weekend_surge_pct),
      tone: r.weekend_surge_pct < 0 ? 'primary' : 'secondary',
      enabled: r.weekend_enabled,
    },
    {
      key: 'holiday',
      label: 'Holiday Peak',
      percent: r.holiday_peak_pct,
      value: fmt(r.holiday_peak_pct),
      tone: r.holiday_peak_pct < 0 ? 'primary' : 'secondary',
      enabled: r.holiday_enabled,
    },
    {
      key: 'lastMinute',
      label: 'Last Minute Disc.',
      percent: r.last_minute_disc_pct,
      value: fmt(r.last_minute_disc_pct),
      tone: r.last_minute_disc_pct < 0 ? 'primary' : 'secondary',
      enabled: r.last_minute_enabled,
    },
  ];
}

/**
 * Effective nightly price for a date. A manual `price_override` always wins
 * (the provider set it by hand); otherwise dynamic-pricing rules stack on the
 * room base price.
 */
function effectivePrice(
  base: number,
  dateStr: string,
  override: number | null | undefined,
  r: RulesDoc,
  todayStr: string,
  lastEndStr: string,
): number {
  if (override != null) return override;
  let p = base;
  if (r.weekend_enabled && isWeekend(dateStr)) {
    p *= 1 + r.weekend_surge_pct / 100;
  }
  if (r.holiday_enabled && HOLIDAYS.has(dateStr)) {
    p *= 1 + r.holiday_peak_pct / 100;
  }
  if (
    r.last_minute_enabled &&
    dateStr >= todayStr &&
    dateStr <= lastEndStr
  ) {
    p *= 1 + r.last_minute_disc_pct / 100;
  }
  return Math.round(p);
}

async function resolveActiveRoom() {
  const providerId = env.demoProviderId;
  const hotels = await Hotel.find({
    provider_id: providerId,
    deleted_at: null,
  }).lean();
  if (hotels.length === 0) return null;
  const hotelIds = hotels.map((h) => h._id);
  const hotelName = new Map(hotels.map((h) => [h._id, h.name]));
  const room = await Room.findOne({
    hotel_id: { $in: hotelIds },
    deleted_at: null,
  })
    .sort({ _id: 1 })
    .lean();
  if (!room) return null;
  return { providerId, room, hotelName };
}

export async function getInventoryOverview(
  monthParam?: string,
): Promise<InventoryOverviewResponse | null> {
  const ctx = await resolveActiveRoom();
  if (!ctx) return null;
  const { providerId, room, hotelName } = ctx;

  const basePrice = room.base_price ?? 0;
  const { year, monthIdx } = resolveMonth(monthParam);
  const monthStr = `${year}-${pad2(monthIdx + 1)}`;
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const monthStart = `${monthStr}-01`;
  const monthEnd = `${monthStr}-${pad2(daysInMonth)}`;
  const leadingBlanks = (new Date(year, monthIdx, 1).getDay() + 6) % 7;
  const monthLabel = new Date(year, monthIdx, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const rulesDoc = (await ensurePricingRules(providerId)) as unknown as RulesDoc;
  const lastEnd = new Date(now);
  lastEnd.setDate(lastEnd.getDate() + (rulesDoc.last_minute_days ?? 7));
  const lastEndStr = `${lastEnd.getFullYear()}-${pad2(lastEnd.getMonth() + 1)}-${pad2(lastEnd.getDate())}`;

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
    const price = effectivePrice(
      basePrice,
      date,
      row?.price_override,
      rulesDoc,
      todayStr,
      lastEndStr,
    );
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
    pricingRules: rulesViews(rulesDoc),
    analytics: {
      occupancyPct,
      revenueForecast: Math.round(revenueForecast),
      revenueDeltaLabel: REVENUE_DELTA_LABEL,
      demandLevel: demand.level,
      demandNote: demand.note,
    },
  };
}

export async function updateInventoryDay(input: {
  date?: unknown;
  available?: unknown;
  price?: unknown;
}): Promise<InventoryOverviewResponse> {
  const date = input.date;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new InventoryError(400, 'A valid date (YYYY-MM-DD) is required');
  }
  const [yy, mm, dd] = date.split('-').map(Number);
  const probe = new Date(yy, mm - 1, dd);
  if (
    probe.getFullYear() !== yy ||
    probe.getMonth() !== mm - 1 ||
    probe.getDate() !== dd
  ) {
    throw new InventoryError(400, 'Date is not a real calendar day');
  }
  if (typeof input.available !== 'boolean') {
    throw new InventoryError(400, 'available must be true or false');
  }
  const priceNum = Number(input.price);
  if (!Number.isFinite(priceNum) || priceNum <= 0) {
    throw new InventoryError(400, 'price must be a positive number');
  }

  const ctx = await resolveActiveRoom();
  if (!ctx) throw new InventoryError(404, 'No listings for this provider');
  const { room } = ctx;

  const existing = await RoomInventory.findOne({
    room_id: room._id,
    date,
  });
  const defaultQty =
    typeof room.capacity === 'number' && room.capacity > 0
      ? room.capacity
      : 10;
  const qty = !input.available
    ? 0
    : existing && (existing.available_qty ?? 0) > 0
      ? existing.available_qty
      : defaultQty;
  const priceOverride = Math.round(priceNum);
  const now = new Date().toISOString();

  if (existing) {
    existing.available_qty = qty;
    existing.price_override = priceOverride;
    existing.updated_at = now;
    await existing.save();
  } else {
    const top = await RoomInventory.findOne()
      .sort({ _id: -1 })
      .select('_id')
      .lean();
    const nextId = (top?._id ?? 0) + 1;
    await RoomInventory.create({
      _id: nextId,
      room_id: room._id,
      date,
      available_qty: qty,
      price_override: priceOverride,
      created_at: now,
      updated_at: now,
    });
  }

  return (await getInventoryOverview(date.slice(0, 7)))!;
}

export async function updatePricingRules(
  input: {
    weekendSurgePct?: unknown;
    holidayPeakPct?: unknown;
    lastMinuteDiscPct?: unknown;
    lastMinuteDays?: unknown;
    weekendEnabled?: unknown;
    holidayEnabled?: unknown;
    lastMinuteEnabled?: unknown;
  },
  month?: string,
): Promise<InventoryOverviewResponse> {
  const providerId = env.demoProviderId;
  const doc = await ensurePricingRules(providerId);

  const pct = (v: unknown, name: string): number => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < -95 || n > 500) {
      throw new InventoryError(400, `${name} must be between -95 and 500`);
    }
    return Math.round(n);
  };
  const bool = (v: unknown, name: string): boolean => {
    if (typeof v !== 'boolean') {
      throw new InventoryError(400, `${name} must be true or false`);
    }
    return v;
  };

  if (input.weekendSurgePct !== undefined) {
    doc.weekend_surge_pct = pct(input.weekendSurgePct, 'weekendSurgePct');
  }
  if (input.holidayPeakPct !== undefined) {
    doc.holiday_peak_pct = pct(input.holidayPeakPct, 'holidayPeakPct');
  }
  if (input.lastMinuteDiscPct !== undefined) {
    doc.last_minute_disc_pct = pct(input.lastMinuteDiscPct, 'lastMinuteDiscPct');
  }
  if (input.lastMinuteDays !== undefined) {
    const n = Number(input.lastMinuteDays);
    if (!Number.isInteger(n) || n < 0 || n > 365) {
      throw new InventoryError(400, 'lastMinuteDays must be 0–365');
    }
    doc.last_minute_days = n;
  }
  if (input.weekendEnabled !== undefined) {
    doc.weekend_enabled = bool(input.weekendEnabled, 'weekendEnabled');
  }
  if (input.holidayEnabled !== undefined) {
    doc.holiday_enabled = bool(input.holidayEnabled, 'holidayEnabled');
  }
  if (input.lastMinuteEnabled !== undefined) {
    doc.last_minute_enabled = bool(input.lastMinuteEnabled, 'lastMinuteEnabled');
  }
  doc.updated_at = new Date().toISOString();
  await doc.save();

  const m =
    typeof month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)
      ? month
      : undefined;
  return (await getInventoryOverview(m))!;
}
