import { env } from '@/config/env';
import { Activity } from '@/models/Activity.model';
import { Booking } from '@/models/Booking.model';
import { BookingItem } from '@/models/BookingItem.model';
import { Hotel } from '@/models/Hotel.model';
import { Location } from '@/models/Location.model';
import { Provider } from '@/models/Provider.model';
import { ProfileVerification } from '@/models/ProfileVerification.model';
import { Review } from '@/models/Review.model';
import { Room } from '@/models/Room.model';
import { Trip } from '@/models/Trip.model';
import { Wallet } from '@/models/Wallet.model';

type ChatIntent =
  | 'greeting'
  | 'ask_price'
  | 'ask_itinerary'
  | 'suggest_destination'
  | 'book_tour'
  | 'hotel_booking'
  | 'booking_status'
  | 'cancel_policy'
  | 'refund_time'
  | 'payment_method'
  | 'voucher'
  | 'wallet'
  | 'review'
  | 'identity_verification'
  | 'provider_support'
  | 'app_layout'
  | 'app_feature'
  | 'contact_support'
  | 'thanks'
  | 'unknown';

interface ChatRule {
  intent: ChatIntent;
  keywords: string[];
}

interface ChatEntities {
  destination?: string;
  bookingId?: string;
}

interface ChatContextItem {
  type:
    | 'hotel'
    | 'tour'
    | 'booking'
    | 'reviewSummary'
    | 'policy'
    | 'wallet'
    | 'trip'
    | 'provider'
    | 'verification'
    | 'location'
    | 'app';
  title: string;
  details: Record<string, unknown>;
}

export interface ChatResponse {
  reply: string;
  intent: ChatIntent;
  source: 'rule' | 'rule+mongodb' | 'rule+mongodb+llm';
  matchedItems: ChatContextItem[];
}

const priceFormatter = new Intl.NumberFormat('en-US');

const rules: ChatRule[] = [
  { intent: 'greeting', keywords: ['hello', 'hi', 'hey'] },
  {
    intent: 'ask_price',
    keywords: ['price', 'cost', 'fee', 'how much', 'ticket', 'rate'],
  },
  {
    intent: 'ask_itinerary',
    keywords: ['itinerary', 'plan', 'schedule', 'how many days'],
  },
  {
    intent: 'suggest_destination',
    keywords: ['recommend', 'suggest', 'destination', 'where should i go'],
  },
  {
    intent: 'book_tour',
    keywords: ['book tour', 'booking', 'reserve', 'buy tour', 'book room'],
  },
  {
    intent: 'hotel_booking',
    keywords: ['hotel', 'room', 'check in', 'check out'],
  },
  {
    intent: 'booking_status',
    keywords: ['booking status', 'my booking', 'my trips', 'order status'],
  },
  {
    intent: 'cancel_policy',
    keywords: ['cancel', 'cancellation', 'refund', 'reschedule'],
  },
  {
    intent: 'refund_time',
    keywords: ['refund time', 'when refund', 'where is my refund', 'money back'],
  },
  {
    intent: 'payment_method',
    keywords: ['payment', 'card', 'bank card', 'paypal', 'wallet payment'],
  },
  {
    intent: 'voucher',
    keywords: ['voucher', 'coupon', 'discount code', 'promotion', 'promo'],
  },
  { intent: 'wallet', keywords: ['wallet', 'balance', 'points', 'reward points'] },
  { intent: 'review', keywords: ['review', 'rating', 'feedback'] },
  {
    intent: 'identity_verification',
    keywords: [
      'passport',
      'upload passport',
      'up passport',
      'verification',
      'identity',
      'document',
      'id card',
      'verify profile',
      'xac minh',
      'xác minh',
      'giay to',
      'giấy tờ',
      'ho chieu',
      'hộ chiếu',
      'can cuoc',
      'căn cước',
      'cccd',
      'tai len',
      'tải lên',
    ],
  },
  {
    intent: 'provider_support',
    keywords: ['provider', 'host', 'listing', 'manage orders', 'payout'],
  },
  {
    intent: 'app_layout',
    keywords: [
      'layout',
      'navigation',
      'tab',
      'bottom bar',
      'menu',
      'screen',
      'where is',
      'go to',
      'open',
    ],
  },
  {
    intent: 'app_feature',
    keywords: [
      'feature',
      'function',
      'how to use',
      'what can i do',
      'tripwise app',
      'planner',
      'business app',
      'vip',
      'finance',
      'order manager',
    ],
  },
  {
    intent: 'contact_support',
    keywords: ['contact', 'support', 'help center', 'hotline', 'agent'],
  },
  { intent: 'thanks', keywords: ['thank', 'thanks'] },
];

const destinationAliases = [
  'Da Lat',
  'Da Nang',
  'Phu Quoc',
  'Nha Trang',
  'Sa Pa',
  'Hoi An',
  'Hanoi',
  'Ho Chi Minh City',
  'Hue',
  'Ha Long',
];

const APP_LAYOUT_CONTEXT: ChatContextItem[] = [
  {
    type: 'app',
    title: 'Planner layout',
    details: {
      audience: 'traveler/planner',
      topBar: 'Planner pages use a compact top bar with back/profile actions.',
      bottomTabs: ['Home', 'My Trips', 'Planner', 'Wallet', 'Profile'],
      mainScreens: {
        Home: 'Search destinations, dates, hotels, tours, flights, and recommendations.',
        MyTrips: 'View bookings, booking detail, cancel bookings, contact support.',
        Planner: 'Create trips, choose dates/destination, add activities, edit activity time.',
        Wallet: 'View balance, loyalty points, cards, and wallet transactions.',
        Profile:
          'Manage account, support, notifications, provider registration, and identity verification.',
      },
      actionGuides: {
        uploadPassport:
          'Open Profile from the bottom tab, find Verification, tap Continue/Verify Documents, choose Passport, then tap Tap to upload and select an image.',
        removePassport:
          'Open Profile > Verification > Passport, then tap the uploaded passport image/delete control to remove it.',
      },
    },
  },
  {
    type: 'app',
    title: 'Provider layout',
    details: {
      audience: 'provider/business',
      topBar: 'Provider pages use TRIP WISE BUSINESS with notification/profile actions.',
      bottomTabs: ['Dashboard', 'Listings', 'Orders', 'VIP', 'Finance'],
      mainScreens: {
        Dashboard: 'Summary metrics, recent activity, and business status.',
        Listings: 'Create, edit, and manage provider listings.',
        Orders: 'Review pending/confirmed/cancelled orders and chat with guests.',
        VIP: 'Upgrade Elite plan and select or remove listing promotions.',
        Finance: 'Wallet payout balance, lifetime earnings, fees, transactions, payout schedule.',
      },
    },
  },
  {
    type: 'app',
    title: 'Admin layout',
    details: {
      audience: 'admin',
      mainScreens: [
        'Provider approvals',
        'Listing approvals',
        'Refund/cancellation approvals',
        'Provider payouts',
      ],
      note: 'Admin screens are for review and operational approvals, not traveler booking.',
    },
  },
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatVnd(value: number | null | undefined): string {
  if (typeof value !== 'number') return 'No price yet';
  return `$${priceFormatter.format(Math.round(value))}`;
}

function detectIntent(message: string): ChatIntent {
  const normalized = normalize(message);
  let bestIntent: ChatIntent = 'unknown';
  let bestScore = 0;

  for (const rule of rules) {
    const score = rule.keywords.reduce((total, keyword) => {
      return normalized.includes(normalize(keyword)) ? total + 1 : total;
    }, 0);
    if (score > bestScore) {
      bestScore = score;
      bestIntent = rule.intent;
    }
  }

  return bestIntent;
}

function extractEntities(message: string): ChatEntities {
  const normalized = normalize(message);
  const destination = destinationAliases.find((name) => normalized.includes(normalize(name)));
  const bookingId = message.match(/[A-Z0-9]{6,}|[a-f0-9-]{24,}/i)?.[0];
  return { destination, bookingId };
}

async function loadLocationSuggestions(message: string): Promise<ChatContextItem[]> {
  const normalized = normalize(message);
  const tokens = normalized.split(/\s+/).filter((token) => token.length >= 2);
  if (tokens.length === 0) return [];

  const locations = await Location.find({})
    .select({ _id: 1, name: 1, parent_id: 1, type: 1 })
    .sort({ _id: -1 })
    .limit(500)
    .lean();

  const locationMap = new Map(locations.map((location) => [location._id, location]));
  const labelOf = (location: (typeof locations)[number]) => {
    const trail: string[] = [];
    let current: typeof location | undefined = location;
    const seen = new Set<number>();
    while (current && !seen.has(current._id) && trail.length < 6) {
      seen.add(current._id);
      trail.push(current.name);
      current =
        typeof current.parent_id === 'number' ? locationMap.get(current.parent_id) : undefined;
    }
    return trail.join(', ');
  };

  return locations
    .map((location) => ({ location, label: labelOf(location) }))
    .filter(({ label }) => {
      const folded = normalize(label);
      return tokens.every((token) => folded.includes(token));
    })
    .slice(0, 5)
    .map(({ location, label }) => ({
      type: 'location' as const,
      title: location.name,
      details: {
        id: location._id,
        type: location.type ?? null,
        path: label,
      },
    }));
}

async function loadTravelContext(
  intent: ChatIntent,
  entities: ChatEntities,
  message: string,
  userId?: string,
): Promise<ChatContextItem[]> {
  const items: ChatContextItem[] = [];
  const searchText = entities.destination?.trim();
  const nameMatch = searchText ? { $regex: escapeRegExp(searchText), $options: 'i' } : undefined;

  if (['ask_price', 'ask_itinerary', 'suggest_destination', 'book_tour'].includes(intent)) {
    const tours = await Activity.find({
      deleted_at: null,
      status: 'LIVE',
      type: 'TOUR',
      ...(nameMatch ? { title: nameMatch } : {}),
    })
      .select({
        _id: 1,
        title: 1,
        base_price: 1,
        category: 1,
        rating: 1,
        description: 1,
      })
      .sort({ rating: -1, base_price: 1, _id: 1 })
      .limit(5)
      .lean();

    items.push(
      ...tours.map((tour) => ({
        type: 'tour' as const,
        title: tour.title,
        details: {
          id: tour._id,
          price: formatVnd(tour.base_price),
          category: tour.category ?? null,
          rating: tour.rating ?? null,
          description: tour.description ?? null,
        },
      })),
    );
  }

  if (['ask_price', 'hotel_booking', 'suggest_destination', 'book_tour'].includes(intent)) {
    const hotels = await Hotel.find({
      deleted_at: null,
      ...(nameMatch ? { $or: [{ name: nameMatch }, { address: nameMatch }] } : {}),
    })
      .select({ _id: 1, name: 1, address: 1, star_rating: 1, description: 1 })
      .sort({ star_rating: -1, _id: 1 })
      .limit(5)
      .lean();
    const roomPrices = await Room.aggregate<{ _id: number; priceFrom: number }>([
      {
        $match: {
          hotel_id: { $in: hotels.map((hotel) => hotel._id) },
          deleted_at: null,
        },
      },
      { $group: { _id: '$hotel_id', priceFrom: { $min: '$base_price' } } },
    ]);
    const priceByHotelId = new Map(roomPrices.map((room) => [room._id, room.priceFrom] as const));

    items.push(
      ...hotels.map((hotel) => ({
        type: 'hotel' as const,
        title: hotel.name,
        details: {
          id: hotel._id,
          address: hotel.address,
          stars: hotel.star_rating,
          priceFrom: formatVnd(priceByHotelId.get(hotel._id)),
          description: hotel.description ?? null,
        },
      })),
    );
  }

  if (intent === 'booking_status' && userId) {
    const bookingFilter: Record<string, unknown> = {
      user_id: userId,
      deleted_at: null,
    };
    if (entities.bookingId) {
      bookingFilter._id = entities.bookingId;
    }

    const bookings = await Booking.find(bookingFilter)
      .select({
        _id: 1,
        status: 1,
        final_amount: 1,
        total_price: 1,
        currency: 1,
        created_at: 1,
      })
      .sort({ created_at: -1, _id: -1 })
      .limit(3)
      .lean();

    items.push(
      ...bookings.map((booking) => ({
        type: 'booking' as const,
        title: `Booking ${String(booking._id)}`,
        details: {
          id: String(booking._id),
          status: booking.status,
          amount: formatVnd(booking.final_amount || booking.total_price),
          createdAt: booking.created_at ?? null,
        },
      })),
    );

    if (bookings.length > 0) {
      const bookingIds = bookings.map((booking) => String(booking._id));
      const bookingItems = await BookingItem.find({
        booking_id: { $in: bookingIds },
      })
        .select({ booking_id: 1, item_status: 1, start_date: 1, end_date: 1 })
        .limit(6)
        .lean();
      items.push(
        ...bookingItems.map((item) => ({
          type: 'booking' as const,
          title: `Booking detail ${item.booking_id}`,
          details: {
            status: item.item_status,
            startDate: item.start_date ?? null,
            endDate: item.end_date ?? null,
          },
        })),
      );
    }
  }

  if (intent === 'review') {
    const hotels = await Hotel.find({
      deleted_at: null,
      ...(nameMatch ? { $or: [{ name: nameMatch }, { address: nameMatch }] } : {}),
    })
      .select({ _id: 1, name: 1 })
      .limit(3)
      .lean();
    const stats = await Review.aggregate<{
      _id: number;
      average: number;
      count: number;
    }>([
      { $match: { hotel_id: { $in: hotels.map((hotel) => hotel._id) }, deleted_at: null } },
      { $group: { _id: '$hotel_id', average: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);
    const statByHotelId = new Map(stats.map((stat) => [stat._id, stat] as const));
    items.push(
      ...hotels.map((hotel) => ({
        type: 'reviewSummary' as const,
        title: hotel.name,
        details: {
          average: Math.round((statByHotelId.get(hotel._id)?.average ?? 0) * 10) / 10,
          count: statByHotelId.get(hotel._id)?.count ?? 0,
        },
      })),
    );
  }

  if (['cancel_policy', 'refund_time', 'payment_method', 'voucher', 'wallet'].includes(intent)) {
    items.push({
      type: 'policy',
      title: 'Tripwise policy',
      details: {
        cancellation:
          'Cancellation and rescheduling rules depend on each service and are shown in the booking detail page.',
        refund:
          'Refund timing depends on the payment method and the admin review status of the cancellation request.',
        payment:
          'Before confirming payment, review the total amount, dates, points discount, and cancellation policy.',
      },
    });
  }

  if (intent === 'wallet' && userId) {
    const wallet = await Wallet.findOne({ user_id: userId })
      .select({ balance: 1, loyalty_points: 1, updated_at: 1 })
      .lean();
    if (wallet) {
      items.push({
        type: 'wallet',
        title: 'Your Tripwise wallet',
        details: {
          balance: formatVnd(wallet.balance),
          loyaltyPoints: wallet.loyalty_points ?? 0,
          updatedAt: wallet.updated_at ?? null,
        },
      });
    }
  }

  if (intent === 'ask_itinerary' && userId) {
    const trips = await Trip.find({ user_id: userId })
      .select({ _id: 1, title: 1, destination: 1, status: 1, start_date: 1, end_date: 1 })
      .sort({ created_at: -1, _id: -1 })
      .limit(3)
      .lean();
    items.push(
      ...trips.map((trip) => ({
        type: 'trip' as const,
        title: trip.title,
        details: {
          id: trip._id,
          destination: trip.destination ?? null,
          status: trip.status ?? null,
          startDate: trip.start_date ?? null,
          endDate: trip.end_date ?? null,
        },
      })),
    );
  }

  if (intent === 'provider_support' && userId) {
    const provider = await Provider.findOne({ $or: [{ user_id: userId }, { _id: userId }] })
      .select({ _id: 1, business_name: 1, status: 1, vip_plan: 1, vip_promotions: 1 })
      .lean();
    if (provider) {
      const providerData = provider as Record<string, unknown>;
      items.push({
        type: 'provider',
        title: provider.business_name,
        details: {
          id: provider._id,
          status: provider.status ?? null,
          vipPlan: providerData.vip_plan ?? null,
          selectedPromotions: Array.isArray(providerData.vip_promotions)
            ? providerData.vip_promotions.length
            : 0,
        },
      });
    }
  }

  if (intent === 'identity_verification') {
    const verification = userId
      ? await ProfileVerification.findById(userId)
          .select({
            passport_uploaded: 1,
            passport_note: 1,
            address_uploaded: 1,
            address_note: 1,
            updated_at: 1,
          })
          .lean()
      : null;
    items.push({
      type: 'verification',
      title: 'Profile verification',
      details: {
        route: '/profile_registration -> /profile_verification',
        bottomTab: 'Profile',
        section: 'Verification',
        passportCard: 'Passport / Government document',
        uploadAction: 'Tap to upload',
        supportedFiles: 'JPG, PNG, WEBP image files',
        currentPassportStatus: verification?.passport_uploaded ? 'Submitted' : 'Pending',
        currentPassportNote: verification?.passport_note ?? 'Not submitted',
        currentAddressStatus: verification?.address_uploaded ? 'Submitted' : 'Pending',
        currentAddressNote: verification?.address_note ?? 'Not submitted',
      },
    });
  }

  if (intent === 'suggest_destination') {
    items.push(...(await loadLocationSuggestions(`${entities.destination ?? ''} ${message}`)));
    if (items.filter((item) => item.type === 'location').length === 0) {
      items.push(...(await loadLocationSuggestions(message)));
    }
  }

  if (intent === 'app_layout' || intent === 'app_feature') {
    items.push(...APP_LAYOUT_CONTEXT);
  }

  return items.slice(0, 10);
}

function templateReply(intent: ChatIntent, context: ChatContextItem[]): string {
  if (intent === 'greeting') {
    return 'Hello! I can help you find tours, check prices, review bookings, explain cancellation and refund policies, or suggest an itinerary.';
  }
  if (intent === 'thanks') {
    return 'Happy to help. Tell me what else you need for your trip.';
  }
  if (intent === 'contact_support') {
    return 'You can send a message here or open Profile > Help Center to find the best support channel.';
  }
  if (intent === 'provider_support') {
    const provider = context.find((item) => item.type === 'provider');
    const status = provider ? ` Your provider profile is ${provider.details.status ?? 'active'}.` : '';
    return `If you are a provider, use Provider Dashboard to review metrics, Listings to manage inventory, Orders to handle bookings and guest chat, VIP for promotions, and Finance for wallet/payout balance.${status}`;
  }
  if (intent === 'identity_verification') {
    const verification = context.find((item) => item.type === 'verification');
    const status = verification?.details.currentPassportStatus;
    return [
      'Để upload passport trong app Tripwise:',
      '1. Nhấn tab Profile ở thanh dưới cùng.',
      '2. Kéo tới mục Verification.',
      '3. Nhấn Continue hoặc Verify Documents.',
      '4. Ở thẻ Passport / Government document, nhấn Tap to upload.',
      '5. Chọn ảnh passport rõ nét rồi chờ app báo uploaded successfully.',
      status ? `Trạng thái passport hiện tại của bạn: ${status}.` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }
  if (intent === 'app_layout' || intent === 'app_feature') {
    return APP_LAYOUT_CONTEXT.map((item) => {
      const details = item.details;
      if (Array.isArray(details.bottomTabs)) {
        return `${item.title}: bottom tabs are ${(details.bottomTabs as string[]).join(', ')}.`;
      }
      if (Array.isArray(details.mainScreens)) {
        return `${item.title}: ${(details.mainScreens as string[]).join(', ')}.`;
      }
      return item.title;
    }).join('\n');
  }

  const tours = context.filter((item) => item.type === 'tour');
  const hotels = context.filter((item) => item.type === 'hotel');
  const bookings = context.filter((item) => item.type === 'booking');

  if (intent === 'booking_status') {
    if (bookings.length === 0) {
      return 'I could not find a matching booking in your account. Check the booking code or open My Trips to see your orders.';
    }
    return `I found ${bookings.length} related booking record(s):\n${bookings
      .slice(0, 4)
      .map((item) => `- ${item.title}: ${JSON.stringify(item.details)}`)
      .join('\n')}`;
  }

  if (intent === 'ask_price') {
    const lines = [...tours, ...hotels].slice(0, 5).map((item) => {
      const price = item.details.price ?? item.details.priceFrom ?? 'No price yet';
      return `- ${item.title}: from ${price}`;
    });
    if (lines.length > 0) {
      return `I found a few matching options:\n${lines.join('\n')}`;
    }
    return 'I could not find a matching price in the current data. Tell me the destination or service type you want to search for.';
  }

  if (['suggest_destination', 'book_tour', 'hotel_booking', 'ask_itinerary'].includes(intent)) {
    const lines = [...tours, ...hotels].slice(0, 5).map((item) => {
      const price = item.details.price ?? item.details.priceFrom ?? 'No price yet';
      return `- ${item.title}: ${price}`;
    });
    if (lines.length > 0) {
      return `Based on Tripwise data, you may want to consider:\n${lines.join('\n')}`;
    }
  }

  if (intent === 'cancel_policy') {
    return 'Cancellation or rescheduling depends on each service. Open the booking in My Trips to see the cancellation deadline, any fee, and refund status.';
  }
  if (intent === 'refund_time') {
    return 'Refund timing depends on the payment method and admin review status. If it takes longer than expected, contact support with your booking code.';
  }
  if (intent === 'payment_method') {
    return 'You can pay with the methods shown on the checkout screen. Review dates, total amount, points discount, and cancellation policy before confirming.';
  }
  if (intent === 'voucher') {
    return 'You can enter a discount code on checkout if the service supports it. Some vouchers depend on travel dates, order value, or service type.';
  }
  if (intent === 'wallet') {
    const wallet = context.find((item) => item.type === 'wallet');
    if (wallet) {
      return `Your wallet balance is ${wallet.details.balance}, with ${wallet.details.loyaltyPoints} loyalty points. Open Wallet to view cards and transaction history.`;
    }
    return 'Open Wallet to view your balance, points, cards, and transaction history.';
  }
  if (intent === 'review') {
    const reviews = context.filter((item) => item.type === 'reviewSummary');
    if (reviews.length > 0) {
      return `Current review summary:\n${reviews
        .map((item) => `- ${item.title}: ${item.details.average}/5 (${item.details.count} reviews)`)
        .join('\n')}`;
    }
    return 'You can read reviews on a service detail page or leave a review after completing your trip.';
  }

  return 'I do not have enough information to answer precisely yet. Ask me about a destination, price, booking, payment, points, or cancellation policy.';
}

async function callLlm(input: {
  message: string;
  intent: ChatIntent;
  context: ChatContextItem[];
  template: string;
}): Promise<string | null> {
  if (!env.llmApiKey) return null;

  const prompt = JSON.stringify({
    instruction:
      'You are the Tripwise travel assistant. Use only the CONTEXT and draft answer. Do not invent prices, booking statuses, policies, navigation, or unavailable data. Reply concisely in the same language as the user when obvious; otherwise use English.',
    question: input.message,
    intent: input.intent,
    context: input.context,
    draftAnswer: input.template,
  });

  const response = await fetch(env.llmApiUrl, {
    method: 'POST',
    headers: {
      'x-goog-api-key': env.llmApiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
      },
    }),
  });

  if (!response.ok) return null;
  const data = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
}

export async function answerChat(input: {
  message: string;
  userId?: string;
}): Promise<ChatResponse> {
  const message = input.message.trim();
  const intent = detectIntent(message);
  const entities = extractEntities(message);
  const context = await loadTravelContext(intent, entities, message, input.userId);
  const template = templateReply(intent, context);
  const llmReply = await callLlm({ message, intent, context, template });

  return {
    reply: llmReply ?? template,
    intent,
    source: llmReply ? 'rule+mongodb+llm' : context.length > 0 ? 'rule+mongodb' : 'rule',
    matchedItems: context,
  };
}
