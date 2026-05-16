import { Schema, model, InferSchemaType } from 'mongoose';

// Mock payment card. Not real card data — every new card is seeded with a
// fixed VND balance so top-up/withdraw can move "real-feeling" money.
const cardSchema = new Schema(
  {
    _id: { type: String, required: true },
    user_id: { type: String, required: true },
    brand: { type: String, required: true },
    last4: { type: String, required: true },
    holder_name: { type: String, default: null },
    balance: { type: Number, required: true },
    is_default: { type: Boolean, default: false },
    created_at: { type: String },
    updated_at: { type: String },
  },
  { collection: 'cards', versionKey: false, _id: false, strict: false },
);

export type CardDoc = InferSchemaType<typeof cardSchema> & { _id: string };
export const Card = model<CardDoc>('Card', cardSchema);
