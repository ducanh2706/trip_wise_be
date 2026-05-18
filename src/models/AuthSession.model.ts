import { Schema, model, InferSchemaType } from 'mongoose';

const authSessionSchema = new Schema(
  {
    _id: { type: String, required: true },
    user_id: { type: String, required: true, index: true },
    expires_at: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
    created_at: { type: Date, required: true },
    last_used_at: { type: Date, required: true },
    user_agent: { type: String, default: null },
  },
  { collection: 'auth_sessions', versionKey: false, _id: false, strict: false },
);

export type AuthSessionDoc = InferSchemaType<typeof authSessionSchema> & {
  _id: string;
};

export const AuthSession = model<AuthSessionDoc>(
  'AuthSession',
  authSessionSchema,
);
