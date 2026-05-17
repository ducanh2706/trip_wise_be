import { Schema, model, InferSchemaType } from 'mongoose';

const roomInventorySchema = new Schema(
  {
    _id: { type: Number, required: true },
    room_id: { type: Number, required: true },
    date: { type: String, required: true },
    available_qty: { type: Number, required: true },
    price_override: { type: Number, default: null },
    created_at: { type: String },
    updated_at: { type: String },
  },
  { collection: 'room_inventory', versionKey: false, _id: false, strict: false },
);

export type RoomInventoryDoc = InferSchemaType<typeof roomInventorySchema> & {
  _id: number;
};
export const RoomInventory = model<RoomInventoryDoc>(
  'RoomInventory',
  roomInventorySchema,
);
