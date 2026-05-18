import { Schema, model, InferSchemaType } from 'mongoose';

const userSchema = new Schema(
  {
    _id: { type: String, required: true },
    full_name: { type: String },
    email: { type: String },
    email_normalized: { type: String, unique: true, sparse: true },
    firebase_uid: { type: String, unique: true, sparse: true },
    phone: { type: String },
    image: { type: String },
    role: { type: String },
    status: { type: String },
    auth_provider: { type: String },
    password_hash: { type: String },
    password_salt: { type: String },
    created_at: { type: String },
    updated_at: { type: String },
    last_login_at: { type: String },
  },
  { collection: 'users', versionKey: false, _id: false, strict: false },
);

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: string };
export const User = model<UserDoc>('User', userSchema);
