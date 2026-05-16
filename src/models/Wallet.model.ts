import { Schema, model, InferSchemaType } from 'mongoose';

const walletSchema = new Schema(
  {
    _id: { type: String, required: true },
    user_id: { type: String, required: true },
    balance: { type: Number, required: true },
    loyalty_points: { type: Number, required: true },
    version: { type: Number },
    created_at: { type: String },
    updated_at: { type: String },
  },
  { collection: 'wallets', versionKey: false, _id: false, strict: false },
);

export type WalletDoc = InferSchemaType<typeof walletSchema> & { _id: string };
export const Wallet = model<WalletDoc>('Wallet', walletSchema);
