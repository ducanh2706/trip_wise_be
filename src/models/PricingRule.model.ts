import { Schema, model, InferSchemaType } from 'mongoose';

// One doc per provider (`_id` = provider_id). Idempotently created with
// sensible defaults — mirrors the NotificationPreference pattern.
const pricingRuleSchema = new Schema(
  {
    _id: { type: String, required: true },
    weekend_surge_pct: { type: Number, default: 20 },
    holiday_peak_pct: { type: Number, default: 35 },
    last_minute_disc_pct: { type: Number, default: -10 },
    last_minute_days: { type: Number, default: 7 },
    weekend_enabled: { type: Boolean, default: true },
    holiday_enabled: { type: Boolean, default: true },
    last_minute_enabled: { type: Boolean, default: true },
    created_at: { type: String },
    updated_at: { type: String },
  },
  { collection: 'pricing_rules', versionKey: false, _id: false, strict: false },
);

export type PricingRuleDoc = InferSchemaType<typeof pricingRuleSchema> & {
  _id: string;
};
export const PricingRule = model<PricingRuleDoc>(
  'PricingRule',
  pricingRuleSchema,
);
