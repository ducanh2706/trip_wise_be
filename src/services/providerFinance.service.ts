import { randomUUID } from 'crypto';
import { Activity, type ActivityDoc } from '@/models/Activity.model';
import { Airport, type AirportDoc } from '@/models/Airport.model';
import { BookingItem, type BookingItemDoc } from '@/models/BookingItem.model';
import { Flight, type FlightDoc } from '@/models/Flight.model';
import { Hotel, type HotelDoc } from '@/models/Hotel.model';
import { PayoutRequest, type PayoutRequestDoc } from '@/models/PayoutRequest.model';
import { Provider, type ProviderDoc } from '@/models/Provider.model';
import { Room, type RoomDoc } from '@/models/Room.model';

const CURRENCY = 'VND';
const SERVICE_FEE_RATE = 0.08;
const DEFAULT_TX_LIMIT = 10;

type Period = 'weekly' | 'monthly' | 'yearly';
type TxStatus = 'all' | 'paid' | 'pending' | 'cancelled';
type ServiceType = 'hotel' | 'flight' | 'activity';

type LeanProvider = Pick<ProviderDoc, '_id' | 'business_name'>;
type LeanItem = BookingItemDoc;
type LeanRoom = Pick<RoomDoc, '_id' | 'hotel_id' | 'room_type'>;
type LeanHotel = Pick<HotelDoc, '_id' | 'name'>;
type LeanFlight = Pick<
  FlightDoc,
  '_id' | 'flight_number' | 'departure_airport' | 'arrival_airport'
>;
type LeanAirport = Pick<AirportDoc, '_id' | 'name'>;
type LeanActivity = Pick<ActivityDoc, '_id' | 'title' | 'type'>;

export interface ProviderFinanceBar {
  key: string;
  label: string;
  value: number;
  displayValue: string;
  heightFactor: number;
  highlighted: boolean;
}

export interface ProviderFinanceTransaction {
  id: string;
  bookingId: string;
  title: string;
  subtitle: string;
  date: string;
  time: string;
  amount: number;
  displayAmount: string;
  status: TxStatus;
  statusLabel: string;
  serviceType: ServiceType;
  iconKey: string;
  createdAt: string | null;
}

export interface ProviderPayoutRequestResponse {
  id: string;
  providerId: string;
  amount: number;
  displayAmount: string;
  currency: string;
  status: string;
  requestedAt: string | null;
  scheduledFor: string | null;
  paidAt: string | null;
  note: string | null;
}

export interface ProviderFinanceResponse {
  provider: { id: string; businessName: string };
  currency: string;
  overview: {
    availableForPayout: number;
    displayAvailableForPayout: string;
    totalLifetimeEarnings: number;
    displayTotalLifetimeEarnings: string;
    servicesProvided: number;
    displayServicesProvided: string;
    serviceFees: number;
    displayServiceFees: string;
    serviceFeeRate: number;
    serviceFeePercentLabel: string;
    netEarningRatio: number;
  };
  earningsHistory: {
    period: Period;
    peakLabel: string;
    bars: ProviderFinanceBar[];
  };
  growth: {
    percent: number;
    displayPercent: string;
    deltaPercent: number;
    displayDeltaPercent: string;
    comparisonLabel: string;
  };
  recentTransactions: {
    query: string;
    status: TxStatus;
    total: number;
    items: ProviderFinanceTransaction[];
  };
  payoutSchedule: {
    nextPayoutDate: string;
    nextPayoutLabel: string;
    pendingRequestsTotal: number;
    displayPendingRequestsTotal: string;
    requests: ProviderPayoutRequestResponse[];
  };
}

export class ProviderFinanceError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function normalizePeriod(value: unknown): Period {
  if (typeof value !== 'string') return 'monthly';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'weekly' || normalized === 'yearly') return normalized;
  return 'monthly';
}

function normalizeTxStatus(value: unknown): TxStatus {
  if (typeof value !== 'string') return 'all';
  switch (value.trim().toLowerCase()) {
    case 'paid':
    case 'confirmed':
    case 'completed':
      return 'paid';
    case 'pending':
      return 'pending';
    case 'cancelled':
    case 'canceled':
      return 'cancelled';
    default:
      return 'all';
  }
}

function itemStatus(value: unknown): TxStatus {
  if (typeof value !== 'string') return 'pending';
  switch (value.trim().toUpperCase()) {
    case 'CONFIRMED':
    case 'PAID':
    case 'COMPLETED':
    case 'DONE':
    case 'ACCEPTED':
    case 'APPROVED':
      return 'paid';
    case 'CANCELLED':
    case 'CANCELED':
    case 'REJECTED':
      return 'cancelled';
    default:
      return 'pending';
  }
}

function amountOf(item: LeanItem): number {
  return typeof item.total_price === 'number' && Number.isFinite(item.total_price)
    ? item.total_price
    : 0;
}

function isEarned(item: LeanItem): boolean {
  return itemStatus(item.item_status) === 'paid';
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: CURRENCY,
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

function formatCompact(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

function compactNumbers(values: Array<number | null | undefined>): number[] {
  return Array.from(new Set(values.filter((value): value is number => typeof value === 'number')));
}

function compactStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values.filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  );
}

function itemDate(item: LeanItem): Date {
  const raw = item.created_at ?? item.start_date ?? item.updated_at;
  const date = raw ? new Date(raw) : new Date(0);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  });
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function addYears(date: Date, years: number): Date {
  return new Date(date.getFullYear() + years, 0, 1);
}

function anchorDate(items: LeanItem[]): Date {
  const latest = items.map(itemDate).sort((left, right) => right.getTime() - left.getTime())[0];
  return latest && latest.getTime() > 0 ? latest : new Date();
}

function bucketConfig(period: Period, anchor: Date) {
  if (period === 'weekly') {
    const currentStart = addDays(startOfDay(anchor), -6);
    const starts = Array.from({ length: 7 }, (_, index) => addDays(currentStart, index));
    return {
      comparisonLabel: 'from last week',
      currentStart,
      currentEnd: addDays(currentStart, 7),
      previousStart: addDays(currentStart, -7),
      previousEnd: currentStart,
      buckets: starts.map((start) => ({
        key: start.toISOString().slice(0, 10),
        label: start.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
        start,
        end: addDays(start, 1),
      })),
    };
  }

  if (period === 'yearly') {
    const currentStart = new Date(anchor.getFullYear(), 0, 1);
    const starts = Array.from({ length: 5 }, (_, index) => addYears(currentStart, index - 4));
    return {
      comparisonLabel: 'from last year',
      currentStart,
      currentEnd: addYears(currentStart, 1),
      previousStart: addYears(currentStart, -1),
      previousEnd: currentStart,
      buckets: starts.map((start) => ({
        key: String(start.getFullYear()),
        label: String(start.getFullYear()),
        start,
        end: addYears(start, 1),
      })),
    };
  }

  const currentStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const starts = Array.from({ length: 6 }, (_, index) => addMonths(currentStart, index - 5));
  return {
    comparisonLabel: 'from last month',
    currentStart,
    currentEnd: addMonths(currentStart, 1),
    previousStart: addMonths(currentStart, -1),
    previousEnd: currentStart,
    buckets: starts.map((start) => ({
      key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
      label: start.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
      start,
      end: addMonths(start, 1),
    })),
  };
}

function sumInRange(items: LeanItem[], start: Date, end: Date): number {
  return items.reduce((sum, item) => {
    const date = itemDate(item);
    return date >= start && date < end ? sum + amountOf(item) * (1 - SERVICE_FEE_RATE) : sum;
  }, 0);
}

function buildHistory(items: LeanItem[], period: Period) {
  const earned = items.filter(isEarned);
  const config = bucketConfig(period, anchorDate(earned));
  const values = config.buckets.map((bucket) => sumInRange(earned, bucket.start, bucket.end));
  const maxValue = Math.max(...values, 0);
  const highlightedIndex = values.indexOf(maxValue);
  const percentBase = sumInRange(earned, config.previousStart, config.previousEnd);
  const percentCurrent = sumInRange(earned, config.currentStart, config.currentEnd);
  const percent =
    percentBase > 0
      ? ((percentCurrent - percentBase) / percentBase) * 100
      : percentCurrent > 0
        ? 100
        : 0;
  const roundedPercent = Math.round(percent * 10) / 10;

  return {
    chart: {
      period,
      peakLabel: formatCompact(maxValue),
      bars: config.buckets.map<ProviderFinanceBar>((bucket, index) => ({
        key: bucket.key,
        label: bucket.label,
        value: values[index],
        displayValue: formatCurrency(values[index]),
        heightFactor: maxValue > 0 ? Math.max(values[index] / maxValue, 0.08) : 0.08,
        highlighted: index === highlightedIndex && maxValue > 0,
      })),
    },
    growth: {
      percent: roundedPercent,
      displayPercent: `${roundedPercent >= 0 ? '+' : ''}${roundedPercent.toFixed(1)}%`,
      deltaPercent: roundedPercent,
      displayDeltaPercent: `${roundedPercent >= 0 ? '+' : ''}${roundedPercent.toFixed(1)}%`,
      comparisonLabel: config.comparisonLabel,
    },
  };
}

async function resolveProvider(providerId?: string): Promise<LeanProvider> {
  if (providerId) {
    const provider = (await Provider.findById(providerId)
      .select({ _id: 1, business_name: 1 })
      .lean()) as LeanProvider | null;
    if (!provider) throw new ProviderFinanceError(404, 'Provider not found');
    return provider;
  }

  const recentItem = (await BookingItem.findOne({})
    .select({ provider_id: 1 })
    .sort({ created_at: -1, _id: -1 })
    .lean()) as Pick<LeanItem, 'provider_id'> | null;

  const provider = recentItem?.provider_id
    ? ((await Provider.findById(recentItem.provider_id)
        .select({ _id: 1, business_name: 1 })
        .lean()) as LeanProvider | null)
    : null;
  if (provider) return provider;

  const fallback = (await Provider.findOne({})
    .select({ _id: 1, business_name: 1 })
    .sort({ _id: 1 })
    .lean()) as LeanProvider | null;
  if (!fallback) throw new ProviderFinanceError(404, 'No provider found');
  return fallback;
}

async function loadContext(items: LeanItem[]) {
  const roomIds = compactNumbers(items.map((item) => item.room_id));
  const flightIds = compactNumbers(items.map((item) => item.flight_id));
  const activityIds = compactNumbers(items.map((item) => item.activity_id));
  const rooms = (await Room.find({ _id: { $in: roomIds }, deleted_at: null })
    .select({ _id: 1, hotel_id: 1, room_type: 1 })
    .lean()) as LeanRoom[];
  const hotels = (await Hotel.find({
    _id: { $in: compactNumbers(rooms.map((room) => room.hotel_id)) },
    deleted_at: null,
  })
    .select({ _id: 1, name: 1 })
    .lean()) as LeanHotel[];
  const flights = (await Flight.find({ _id: { $in: flightIds }, deleted_at: null })
    .select({ _id: 1, flight_number: 1, departure_airport: 1, arrival_airport: 1 })
    .lean()) as LeanFlight[];
  const airports = (await Airport.find({
    _id: {
      $in: compactStrings(
        flights.flatMap((flight) => [flight.departure_airport, flight.arrival_airport]),
      ),
    },
  })
    .select({ _id: 1, name: 1 })
    .lean()) as LeanAirport[];
  const activities = (await Activity.find({ _id: { $in: activityIds }, deleted_at: null })
    .select({ _id: 1, title: 1, type: 1 })
    .lean()) as LeanActivity[];

  return {
    roomMap: new Map(rooms.map((room) => [room._id, room] as const)),
    hotelMap: new Map(hotels.map((hotel) => [hotel._id, hotel] as const)),
    flightMap: new Map(flights.map((flight) => [flight._id, flight] as const)),
    airportMap: new Map(airports.map((airport) => [airport._id, airport] as const)),
    activityMap: new Map(activities.map((activity) => [activity._id, activity] as const)),
  };
}

function describeItem(item: LeanItem, context: Awaited<ReturnType<typeof loadContext>>) {
  const room = item.room_id ? context.roomMap.get(item.room_id) : undefined;
  const hotel = room ? context.hotelMap.get(room.hotel_id) : undefined;
  const flight = item.flight_id ? context.flightMap.get(item.flight_id) : undefined;
  const activity = item.activity_id ? context.activityMap.get(item.activity_id) : undefined;

  if (room || hotel) {
    return {
      subtitle: `${hotel?.name ?? 'Hotel stay'}${room?.room_type ? ` · ${room.room_type}` : ''}`,
      serviceType: 'hotel' as ServiceType,
      iconKey: 'hotel',
    };
  }

  if (flight) {
    return {
      subtitle: `${flight.departure_airport} - ${flight.arrival_airport} (${flight.flight_number})`,
      serviceType: 'flight' as ServiceType,
      iconKey: 'flight',
    };
  }

  return {
    subtitle: activity?.title ?? 'Activity booking',
    serviceType: 'activity' as ServiceType,
    iconKey: 'activity',
  };
}

function toTransaction(
  item: LeanItem,
  context: Awaited<ReturnType<typeof loadContext>>,
): ProviderFinanceTransaction {
  const createdAt = item.created_at ?? item.updated_at ?? null;
  const status = itemStatus(item.item_status);
  const description = describeItem(item, context);
  return {
    id: item._id,
    bookingId: item.booking_id,
    title: `Booking #${item.booking_id}`,
    subtitle: description.subtitle,
    date: formatDate(createdAt),
    time: formatTime(createdAt),
    amount: amountOf(item),
    displayAmount: formatCurrency(amountOf(item)),
    status,
    statusLabel: status === 'paid' ? 'PAID' : status === 'cancelled' ? 'CANCELLED' : 'PENDING',
    serviceType: description.serviceType,
    iconKey: description.iconKey,
    createdAt,
  };
}

function mapRequest(doc: PayoutRequestDoc): ProviderPayoutRequestResponse {
  return {
    id: doc._id,
    providerId: doc.provider_id,
    amount: doc.amount,
    displayAmount: formatCurrency(doc.amount),
    currency: doc.currency ?? CURRENCY,
    status: doc.status ?? 'PENDING',
    requestedAt: doc.requested_at ?? null,
    scheduledFor: doc.scheduled_for ?? null,
    paidAt: doc.paid_at ?? null,
    note: doc.note ?? null,
  };
}

function nextFriday(from = new Date()): Date {
  const next = startOfDay(from);
  const distance = (5 - next.getDay() + 7) % 7 || 7;
  next.setDate(next.getDate() + distance);
  return next;
}

async function payoutRequests(providerId: string): Promise<PayoutRequestDoc[]> {
  return (await PayoutRequest.find({ provider_id: providerId })
    .sort({ requested_at: -1, _id: -1 })
    .limit(20)
    .lean()) as PayoutRequestDoc[];
}

function committedPayoutTotal(requests: PayoutRequestDoc[]): number {
  return requests.reduce((sum, request) => {
    return ['PENDING', 'SCHEDULED', 'PAID'].includes((request.status ?? '').toUpperCase())
      ? sum + request.amount
      : sum;
  }, 0);
}

export async function getProviderFinance(input: {
  providerId?: string;
  period?: string;
  query?: string;
  status?: string;
  limit?: number;
}): Promise<ProviderFinanceResponse> {
  const provider = await resolveProvider(input.providerId);
  const period = normalizePeriod(input.period);
  const status = normalizeTxStatus(input.status);
  const [itemsRaw, requests] = await Promise.all([
    BookingItem.find({ provider_id: provider._id }).sort({ created_at: -1, _id: -1 }).lean(),
    payoutRequests(provider._id),
  ]);
  const items = itemsRaw as LeanItem[];
  const earnedItems = items.filter(isEarned);
  const servicesProvided = earnedItems.reduce((sum, item) => sum + amountOf(item), 0);
  const serviceFees = servicesProvided * SERVICE_FEE_RATE;
  const totalLifetimeEarnings = servicesProvided - serviceFees;
  const availableForPayout = Math.max(totalLifetimeEarnings - committedPayoutTotal(requests), 0);
  const history = buildHistory(items, period);
  const context = await loadContext(items.slice(0, 100));
  const allTransactions = items.map((item) => toTransaction(item, context));
  const query = (input.query ?? '').trim().toLowerCase();
  const filteredTransactions = allTransactions.filter((transaction) => {
    if (status !== 'all' && transaction.status !== status) return false;
    if (!query) return true;
    return [transaction.bookingId, transaction.title, transaction.subtitle]
      .join(' ')
      .toLowerCase()
      .includes(query);
  });
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_TX_LIMIT, 1), 50);
  const pendingRequestsTotal = requests.reduce((sum, request) => {
    return ['PENDING', 'SCHEDULED'].includes((request.status ?? '').toUpperCase())
      ? sum + request.amount
      : sum;
  }, 0);
  const nextPayoutDate = nextFriday();

  return {
    provider: { id: provider._id, businessName: provider.business_name },
    currency: CURRENCY,
    overview: {
      availableForPayout,
      displayAvailableForPayout: formatCurrency(availableForPayout),
      totalLifetimeEarnings,
      displayTotalLifetimeEarnings: formatCurrency(totalLifetimeEarnings),
      servicesProvided,
      displayServicesProvided: formatCurrency(servicesProvided),
      serviceFees,
      displayServiceFees: `-${formatCurrency(serviceFees)}`,
      serviceFeeRate: SERVICE_FEE_RATE,
      serviceFeePercentLabel: `${Math.round(SERVICE_FEE_RATE * 100)}%`,
      netEarningRatio: servicesProvided > 0 ? totalLifetimeEarnings / servicesProvided : 0,
    },
    earningsHistory: history.chart,
    growth: history.growth,
    recentTransactions: {
      query,
      status,
      total: filteredTransactions.length,
      items: filteredTransactions.slice(0, limit),
    },
    payoutSchedule: {
      nextPayoutDate: nextPayoutDate.toISOString(),
      nextPayoutLabel: formatDate(nextPayoutDate.toISOString()),
      pendingRequestsTotal,
      displayPendingRequestsTotal: formatCurrency(pendingRequestsTotal),
      requests: requests.map(mapRequest),
    },
  };
}

export async function listProviderPayoutRequests(input: {
  providerId?: string;
}): Promise<{ providerId: string; items: ProviderPayoutRequestResponse[] }> {
  const provider = await resolveProvider(input.providerId);
  const requests = await payoutRequests(provider._id);
  return { providerId: provider._id, items: requests.map(mapRequest) };
}

export async function requestProviderPayout(input: {
  providerId?: string;
  amount?: number;
}): Promise<ProviderPayoutRequestResponse> {
  const provider = await resolveProvider(input.providerId);
  const finance = await getProviderFinance({ providerId: provider._id });
  const amount =
    typeof input.amount === 'number' && Number.isFinite(input.amount)
      ? Math.round(input.amount)
      : Math.round(finance.overview.availableForPayout);

  if (amount <= 0) throw new ProviderFinanceError(400, 'Payout amount must be greater than zero');
  if (amount > finance.overview.availableForPayout) {
    throw new ProviderFinanceError(400, 'Payout amount exceeds available balance');
  }

  const request = await PayoutRequest.create({
    _id: randomUUID(),
    provider_id: provider._id,
    amount,
    currency: CURRENCY,
    status: 'PENDING',
    requested_at: new Date().toISOString(),
    scheduled_for: nextFriday().toISOString(),
    note: 'Provider requested payout from finance dashboard',
  });

  return mapRequest(request.toObject() as PayoutRequestDoc);
}
