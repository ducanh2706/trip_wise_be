import { Schema, model, InferSchemaType } from 'mongoose';

// Mock wallet ledger entry written by top-up / withdraw. Separate from the
// seeded `payments` collection so we never mutate that booking data.
const walletTxSchema = new Schema(
  {
    _id: { type: String, required: true },
    user_id: { type: String, required: true },
    type: { type: String, required: true }, // 'TOPUP' | 'WITHDRAW'
    amount: { type: Number, required: true }, // always positive; sign derived from type
    card_id: { type: String, required: true },
    card_last4: { type: String, default: null },
    status: { type: String, default: 'SUCCESS' },
    created_at: { type: String },
  },
  { collection: 'wallet_transactions', versionKey: false, _id: false, strict: false },
);

export type WalletTxDoc = InferSchemaType<typeof walletTxSchema> & { _id: string };
export const WalletTx = model<WalletTxDoc>('WalletTransaction', walletTxSchema);
