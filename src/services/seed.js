import bcrypt from 'bcrypt';
import { env } from '../config/env.js';
import { AdminUser } from '../models/AdminUser.js';
import { Category, MAIN_CATEGORIES } from '../models/Category.js';
import { getSettings } from '../models/Setting.js';

export const DEV_ADMIN = { email: 'a@gmail.com', password: '12345', name: 'Development Admin' };

export async function seedCategories() {
  for (const c of MAIN_CATEGORIES) {
    await Category.updateOne({ slug: c.slug }, { $setOnInsert: { ...c, isActive: true } }, { upsert: true });
  }
  return Category.find().sort({ name: 1 });
}

/** Creates the local development admin. Never runs in production. */
export async function seedDevelopmentAdmin() {
  if (env.isProduction) throw new Error('The development admin seed is disabled in production.');
  const existing = await AdminUser.findOne({ email: DEV_ADMIN.email });
  if (existing) return { created: false, admin: existing };
  const admin = await AdminUser.create({
    name: DEV_ADMIN.name,
    email: DEV_ADMIN.email,
    passwordHash: await bcrypt.hash(DEV_ADMIN.password, 12),
    role: 'superadmin',
    mustChangePassword: true,
    isDevelopmentSeed: true,
  });
  return { created: true, admin };
}

export async function seedBase() {
  const categories = await seedCategories();
  await getSettings();
  return { categories };
}
