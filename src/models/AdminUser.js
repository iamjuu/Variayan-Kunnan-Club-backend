import mongoose from 'mongoose';

const adminUserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ['admin', 'superadmin'], default: 'admin' },
    mustChangePassword: { type: Boolean, default: false },
    isDevelopmentSeed: { type: Boolean, default: false },
    tokenVersion: { type: Number, default: 0 },
    failedLoginCount: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'adminUsers' },
);

adminUserSchema.set('toJSON', {
  transform(_doc, ret) {
    return {
      id: String(ret._id),
      name: ret.name,
      email: ret.email,
      role: ret.role,
      mustChangePassword: ret.mustChangePassword,
      isDevelopmentSeed: ret.isDevelopmentSeed,
      lastLoginAt: ret.lastLoginAt,
    };
  },
});

export const AdminUser = mongoose.model('AdminUser', adminUserSchema);
