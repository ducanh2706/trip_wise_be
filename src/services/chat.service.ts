import { env } from '@/config/env';
import { Activity } from '@/models/Activity.model';
import { Booking } from '@/models/Booking.model';
import { BookingItem } from '@/models/BookingItem.model';
import { Hotel } from '@/models/Hotel.model';
import { Review } from '@/models/Review.model';
import { Room } from '@/models/Room.model';

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
  | 'provider_support'
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
  type: 'hotel' | 'tour' | 'booking' | 'reviewSummary' | 'policy';
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
    intent: 'provider_support',
    keywords: ['provider', 'host', 'listing', 'manage orders', 'payout'],
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

async function loadTravelContext(
  intent: ChatIntent,
  entities: ChatEntities,
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
    return 'If you are a provider, use Provider Dashboard to manage listings, Order Manager to handle bookings, and Finance/Payout to track revenue.';
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
    return 'Open Wallet to view your balance, points, and transaction history.';
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
      'You are the Tripwise travel assistant. Use only the CONTEXT and draft answer. Do not invent prices, booking statuses, policies, or unavailable data. Reply concisely in English.',
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
  const context = await loadTravelContext(intent, entities, input.userId);
  const template = templateReply(intent, context);
  const llmReply = await callLlm({ message, intent, context, template });

  return {
    reply: llmReply ?? template,
    intent,
    source: llmReply ? 'rule+mongodb+llm' : context.length > 0 ? 'rule+mongodb' : 'rule',
    matchedItems: context,
  };
}
