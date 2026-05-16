import { Schema, model } from 'mongoose';

export interface HomeSearchDetailDoc {
  icon: string;
  label: string;
  value: string;
}

export interface HomeSearchCardDoc {
  headline: string;
  destinationPlaceholder: string;
  destinationRoute: string;
  searchButtonLabel: string;
  searchButtonRoute: string;
  detailItems: HomeSearchDetailDoc[];
}

export interface HomeCategoryDoc {
  key: string;
  icon: string;
  label: string;
  route: string;
  backgroundTone: string;
  iconTone: string;
}

export interface HomeOffersSectionDoc {
  badgeLabel: string;
  ctaLabels: string[];
  accentTones: string[];
}

export interface HomeRecommendedSectionDoc {
  title: string;
  subtitle: string;
  actionLabel: string;
  actionRoute: string;
  cardHeights: number[];
}

export interface HomeTrendingSectionDoc {
  title: string;
  detailsActionLabel: string;
  actionLabel?: string | null;
  actionRoute?: string | null;
}

export interface HomeSectionsDoc {
  offers: HomeOffersSectionDoc;
  recommended: HomeRecommendedSectionDoc;
  trending: HomeTrendingSectionDoc;
}

export interface HomeCuratedDoc {
  featuredHotelIds: number[];
  recommendedHotelIds: number[];
  trendingHotelIds: number[];
}

export interface HomeOfferOverrideDoc {
  hotelId: number;
  title?: string | null;
  subtitle?: string | null;
  badgeLabel?: string | null;
  ctaLabel?: string | null;
  accentTone?: string | null;
  route?: string | null;
}

export interface HomeRecommendedOverrideDoc {
  hotelId: number;
  title?: string | null;
  caption?: string | null;
  priceLabel?: string | null;
  cardHeight?: number | null;
  route?: string | null;
}

export interface HomeTrendingOverrideDoc {
  hotelId: number;
  detailsLabel?: string | null;
  route?: string | null;
}

export interface HomeContentDoc {
  key: string;
  searchCard: HomeSearchCardDoc;
  categories: HomeCategoryDoc[];
  sections: HomeSectionsDoc;
  curated: HomeCuratedDoc;
  offerOverrides: HomeOfferOverrideDoc[];
  recommendedOverrides: HomeRecommendedOverrideDoc[];
  trendingOverrides: HomeTrendingOverrideDoc[];
}

const homeContentSchema = new Schema<HomeContentDoc>(
  {
    key: { type: String, required: true },
    searchCard: {
      headline: { type: String, required: true },
      destinationPlaceholder: { type: String, required: true },
      destinationRoute: { type: String, required: true },
      searchButtonLabel: { type: String, required: true },
      searchButtonRoute: { type: String, required: true },
      detailItems: [
        {
          icon: { type: String, required: true },
          label: { type: String, required: true },
          value: { type: String, required: true },
        },
      ],
    },
    categories: [
      {
        key: { type: String, required: true },
        icon: { type: String, required: true },
        label: { type: String, required: true },
        route: { type: String, required: true },
        backgroundTone: { type: String, required: true },
        iconTone: { type: String, required: true },
      },
    ],
    sections: {
      offers: {
        badgeLabel: { type: String, required: true },
        ctaLabels: { type: [String], default: undefined },
        accentTones: { type: [String], default: undefined },
      },
      recommended: {
        title: { type: String, required: true },
        subtitle: { type: String, required: true },
        actionLabel: { type: String, required: true },
        actionRoute: { type: String, required: true },
        cardHeights: { type: [Number], default: undefined },
      },
      trending: {
        title: { type: String, required: true },
        detailsActionLabel: { type: String, required: true },
        actionLabel: { type: String, default: null },
        actionRoute: { type: String, default: null },
      },
    },
    curated: {
      featuredHotelIds: { type: [Number], default: undefined },
      recommendedHotelIds: { type: [Number], default: undefined },
      trendingHotelIds: { type: [Number], default: undefined },
    },
    offerOverrides: [
      {
        hotelId: { type: Number, required: true },
        title: { type: String, default: null },
        subtitle: { type: String, default: null },
        badgeLabel: { type: String, default: null },
        ctaLabel: { type: String, default: null },
        accentTone: { type: String, default: null },
        route: { type: String, default: null },
      },
    ],
    recommendedOverrides: [
      {
        hotelId: { type: Number, required: true },
        title: { type: String, default: null },
        caption: { type: String, default: null },
        priceLabel: { type: String, default: null },
        cardHeight: { type: Number, default: null },
        route: { type: String, default: null },
      },
    ],
    trendingOverrides: [
      {
        hotelId: { type: Number, required: true },
        detailsLabel: { type: String, default: null },
        route: { type: String, default: null },
      },
    ],
  },
  {
    collection: 'home_content',
    versionKey: false,
    strict: false,
  },
);

homeContentSchema.index({ key: 1 }, { unique: true });

export const HomeContent = model<HomeContentDoc>('HomeContent', homeContentSchema);
