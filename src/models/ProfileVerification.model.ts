import { InferSchemaType, Schema, model } from 'mongoose';

// One doc per user (`_id` IS user_id) so the profile screen can render
// verification status without wiring file upload storage yet.
const profileVerificationSchema = new Schema(
  {
    _id: { type: String, required: true }, // = user_id
    passport_uploaded: { type: Boolean, default: false },
    passport_note: { type: String, default: 'Not submitted' },
    passport_image_url: { type: String, default: null },
    address_uploaded: { type: Boolean, default: false },
    address_note: { type: String, default: 'Not submitted' },
    address_image_url: { type: String, default: null },
    updated_at: { type: String },
  },
  {
    collection: 'profile_verifications',
    versionKey: false,
    _id: false,
    strict: false,
  },
);

export type ProfileVerificationDoc = InferSchemaType<typeof profileVerificationSchema> & {
  _id: string;
};

export const ProfileVerification = model<ProfileVerificationDoc>(
  'ProfileVerification',
  profileVerificationSchema,
);
