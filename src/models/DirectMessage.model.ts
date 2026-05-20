import { Schema, model, InferSchemaType } from 'mongoose';

const directMessageSchema = new Schema(
  {
    _id: { type: String, required: true },
    conversation_id: { type: String, required: true },
    sender_user_id: { type: String, required: true },
    body: { type: String, required: true },
    read_by: { type: [String], default: [] },
    created_at: { type: String },
    updated_at: { type: String },
  },
  { collection: 'direct_messages', versionKey: false, _id: false, strict: false },
);

export type DirectMessageDoc = InferSchemaType<typeof directMessageSchema> & {
  _id: string;
  conversation_id: string;
  sender_user_id: string;
};

export const DirectMessage = model<DirectMessageDoc>('DirectMessage', directMessageSchema);
