import mongoose from 'mongoose';

export const CONSENT_VERSION = '2026-10-v1';

const settingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'app' },
    registrationOpen: { type: Boolean, default: true },
    individualEventLimit: { type: Number, min: 1, max: 50, default: 3 },
    relayAllowance: { type: Number, min: 0, max: 10, default: 1 },
    relayAllowanceConfirmed: { type: Boolean, default: false },
    ageReferenceDate: { type: Date, default: null },
    collectAadhaar: { type: Boolean, default: false },
    retentionDays: { type: Number, min: 30, max: 3650, default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'AdminUser', default: null },
  },
  { timestamps: true, collection: 'settings' },
);

settingSchema.set('toJSON', {
  transform(_doc, ret) {
    delete ret.__v;
    return ret;
  },
});

export const Setting = mongoose.model('Setting', settingSchema);

export async function getSettings() {
  const existing = await Setting.findOne({ key: 'app' });
  if (existing) return existing;
  return Setting.findOneAndUpdate({ key: 'app' }, { $setOnInsert: { key: 'app' } }, { upsert: true, returnDocument: 'after' });
}
