import { Activity } from '@/models/Activity.model';
import { Location } from '@/models/Location.model';

export interface CatalogActivity {
  id: number;
  title: string;
  description: string | null;
  rating: number;
  image: string | null;
  category: string;
  location: string;
}

export interface ActivityCatalogResponse {
  categories: string[];
  recommended: CatalogActivity | null;
  popular: CatalogActivity[];
}

export const ACTIVITY_CATEGORIES = [
  'FOOD',
  'SIGHTSEEING',
  'TRANSPORT',
  'OUTDOORS',
];

// Resolve location_id -> "Child, Parent" for every id in one round-trip
// each level (no per-activity query).
async function resolveLocations(
  ids: number[],
): Promise<Map<number, string>> {
  const uniq = [...new Set(ids)];
  const locs = await Location.find({ _id: { $in: uniq } }).lean();
  const parentIds = locs
    .map((l) => l.parent_id)
    .filter((x): x is number => x != null);
  const parents = await Location.find({ _id: { $in: parentIds } }).lean();
  const parentById = new Map(parents.map((p) => [p._id, p.name]));

  const out = new Map<number, string>();
  for (const l of locs) {
    const parentName =
      l.parent_id != null ? parentById.get(l.parent_id) : undefined;
    out.set(l._id, parentName ? `${l.name}, ${parentName}` : l.name);
  }
  return out;
}

export async function getActivityCatalog(
  category?: string,
): Promise<ActivityCatalogResponse> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const filter: Record<string, any> = {
    status: 'LIVE',
    deleted_at: null,
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const cat = category?.toUpperCase();
  if (cat && ACTIVITY_CATEGORIES.includes(cat)) filter.category = cat;

  const docs = await Activity.find(filter)
    .sort({ rating: -1, _id: 1 })
    .limit(40)
    .lean();
  const locMap = await resolveLocations(docs.map((d) => d.location_id));

  const all: CatalogActivity[] = docs.map((d) => ({
    id: d._id,
    title: d.title,
    description: d.description ?? null,
    rating: typeof d.rating === 'number' ? d.rating : 0,
    image: d.image ?? null,
    category: d.category ?? 'SIGHTSEEING',
    location: locMap.get(d.location_id) ?? '',
  }));

  return {
    categories: ACTIVITY_CATEGORIES,
    recommended: all[0] ?? null,
    popular: all.slice(1, 13),
  };
}
