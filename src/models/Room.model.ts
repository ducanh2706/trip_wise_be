import { Schema, model, InferSchemaType } from 'mongoose';

const roomSchema = new Schema(
  {
    _id: { type: Number, required: true },
    hotel_id: { type: Number, required: true },
    room_type: { type: String },
    capacity: { type: Number },
    base_price: { type: Number, required: true },
    image: { type: String },
    deleted_at: { type: String, default: null },
  },
  { collection: 'rooms', versionKey: false, _id: false, strict: false },
);

export type RoomDoc = InferSchemaType<typeof roomSchema> & { _id: number };
export const Room = model<RoomDoc>('Room', roomSchema);
