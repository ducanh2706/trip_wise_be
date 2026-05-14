import { Schema, model, InferSchemaType } from 'mongoose';

const providerSchema = new Schema(
  {
    _id: { type: String, required: true },
    business_name: { type: String, required: true },
  },
  { collection: 'providers', versionKey: false, _id: false, strict: false },
);

export type ProviderDoc = InferSchemaType<typeof providerSchema> & { _id: string };
export const Provider = model<ProviderDoc>('Provider', providerSchema);
