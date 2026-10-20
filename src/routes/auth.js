import bcrypt from 'bcrypt';
import { Router } from 'express';
import { z } from 'zod';
import { clearSession, issueSession, requireAdmin } from '../middleware/auth.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { loginLimiter } from '../middleware/rateLimits.js';
import { AdminUser } from '../models/AdminUser.js';
import { badRequest, HttpError, unauthorized } from '../utils/httpError.js';

export const authRouter = Router();
authRouter.use(verifyCsrf);

const BCRYPT_ROUNDS = 12;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
// Compared against when the email is unknown so response time does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', 10);

export const hashPassword = (password) => bcrypt.hash(password, BCRYPT_ROUNDS);

export const strongPassword = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128, 'Password is too long')
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v) && /[^A-Za-z0-9]/.test(v), 'Password must include upper and lower case letters, a number and a symbol');

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required').max(128),
});

authRouter.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const admin = await AdminUser.findOne({ email }).select('+passwordHash');
  if (!admin) {
    await bcrypt.compare(password, DUMMY_HASH);
    throw unauthorized('Invalid email or password');
  }
  if (admin.lockedUntil && admin.lockedUntil > new Date()) {
    throw new HttpError(423, 'Too many failed attempts. Try again in a few minutes.');
  }
  const ok = await bcrypt.compare(password, admin.passwordHash);
  if (!ok) {
    admin.failedLoginCount += 1;
    if (admin.failedLoginCount >= MAX_FAILED_ATTEMPTS) {
      admin.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
      admin.failedLoginCount = 0;
    }
    await admin.save();
    throw unauthorized('Invalid email or password');
  }
  admin.failedLoginCount = 0;
  admin.lockedUntil = null;
  admin.lastLoginAt = new Date();
  await admin.save();
  issueSession(res, admin);
  res.json({ admin: admin.toJSON() });
});

authRouter.post('/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

authRouter.get('/me', requireAdmin, (req, res) => {
  res.json({ admin: req.admin.toJSON() });
});

const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1, 'Current password is required').max(128), newPassword: strongPassword })
  .refine((v) => v.currentPassword !== v.newPassword, { message: 'New password must be different', path: ['newPassword'] });

authRouter.post('/change-password', requireAdmin, async (req, res) => {
  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
  const admin = await AdminUser.findById(req.admin._id).select('+passwordHash');
  if (!(await bcrypt.compare(currentPassword, admin.passwordHash))) throw badRequest('Current password is incorrect');
  if (newPassword.toLowerCase().includes(admin.email.split('@')[0].toLowerCase())) {
    throw badRequest('Password must not contain your email name');
  }
  admin.passwordHash = await hashPassword(newPassword);
  admin.mustChangePassword = false;
  admin.isDevelopmentSeed = false;
  admin.tokenVersion += 1;
  await admin.save();
  issueSession(res, admin);
  res.json({ admin: admin.toJSON() });
});
