import { Schema, model, InferSchemaType } from 'mongoose';

const userSchema = new Schema(
  {
    _id: { type: String, required: true },
    full_name: { type: String },
    email: { type: String },
    phone: { type: String },
    image: { type: String },
    role: { type: String },
    status: { type: String },
  },
  { collection: 'users', versionKey: false, _id: false, strict: false },
);

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: string };
export const User = model<UserDoc>('User', userSchema);
