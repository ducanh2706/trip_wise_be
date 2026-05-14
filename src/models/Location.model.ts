import { Schema, model, InferSchemaType } from 'mongoose';

const locationSchema = new Schema(
  {
    _id: { type: Number, required: true },
    parent_id: { type: Number, default: null },
    name: { type: String, required: true },
    type: { type: String },
  },
  { collection: 'locations', versionKey: false, _id: false, strict: false },
);

export type LocationDoc = InferSchemaType<typeof locationSchema> & { _id: number };
export const Location = model<LocationDoc>('Location', locationSchema);
