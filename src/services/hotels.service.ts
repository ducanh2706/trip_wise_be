import { Hotel } from '@/models/Hotel.model';
import { Room } from '@/models/Room.model';
import { Location } from '@/models/Location.model';
import { Provider } from '@/models/Provider.model';

export interface HotelDetailResponse {
  id: number;
  name: string;
  category: string;
  address: string;
  locationPath: string;
  starRating: number;
  rating: number;
  reviewCount: number;
  latitude: number | null;
  longitude: number | null;
  description: string | null;
  images: string[];
  amenities: string[];
  priceFrom: number | null;
  currency: string;
  host: { id: string; name: string } | null;
  policies: { freeCancellation: boolean };
  isFavoritedByMe: boolean;
  googleMapUrl: string | null;
}

function deriveCategory(starRating: number): string {
  if (starRating >= 5) return 'LUXURY RESORT';
  if (starRating >= 4) return 'PREMIUM HOTEL';
  if (starRating >= 3) return 'HOTEL';
  return 'BUDGET STAY';
}

async function buildLocationPath(startId: number): Promise<string> {
  const names: string[] = [];
  let current: number | null = startId;
  for (let depth = 0; depth < 6 && current !== null; depth++) {
    const loc = await Location.findById(current).lean();
    if (!loc) break;
    names.push(loc.name);
    current = loc.parent_id ?? null;
  }
  return names.join(', ');
}

export async function getHotelDetail(id: number): Promise<HotelDetailResponse | null> {
  const hotel = await Hotel.findOne({ _id: id, deleted_at: null }).lean();
  if (!hotel) return null;

  const [cheapestRoom, provider, locationPath] = await Promise.all([
    Room.findOne({ hotel_id: id, deleted_at: null }).sort({ base_price: 1 }).lean(),
    Provider.findById(hotel.provider_id).lean(),
    buildLocationPath(hotel.location_id),
  ]);

  return {
    id: hotel._id,
    name: hotel.name,
    category: deriveCategory(hotel.star_rating),
    address: hotel.address,
    locationPath,
    starRating: hotel.star_rating,
    rating: hotel.star_rating,
    reviewCount: 0,
    latitude: hotel.latitude ?? null,
    longitude: hotel.longitude ?? null,
    description: hotel.description ?? null,
    images:
      hotel.images && hotel.images.length > 0
        ? hotel.images
        : hotel.image
          ? [hotel.image]
          : [],
    amenities: hotel.amenities ?? [],
    priceFrom: cheapestRoom?.base_price ?? null,
    currency: 'VND',
    host: provider ? { id: provider._id, name: provider.business_name } : null,
    policies: { freeCancellation: true },
    isFavoritedByMe: false,
    googleMapUrl: hotel.google_map_url ?? null,
  };
}
