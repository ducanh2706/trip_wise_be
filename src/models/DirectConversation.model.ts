import { Schema, model, InferSchemaType } from 'mongoose';

const directConversationSchema = new Schema(
  {
    _id: { type: String, required: true },
    participant_user_ids: { type: [String], required: true },
    provider_id: { type: String, default: null },
    booking_id: { type: String, default: null },
    listing_id: { type: Number, default: null },
    title: { type: String },
    subtitle: { type: String },
    avatar_url: { type: String },
    last_message: { type: String },
    last_message_at: { type: String },
    unread_by: { type: [String], default: [] },
    created_at: { type: String },
    updated_at: { type: String },
  },
  { collection: 'direct_conversations', versionKey: false, _id: false, strict: false },
);

export type DirectConversationDoc = InferSchemaType<typeof directConversationSchema> & {
  _id: string;
  participant_user_ids: string[];
};

export const DirectConversation = model<DirectConversationDoc>(
  'DirectConversation',
  directConversationSchema,
);
