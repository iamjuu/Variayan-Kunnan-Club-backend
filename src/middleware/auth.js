import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AdminUser } from '../models/AdminUser.js';
import { forbidden, unauthorized } from '../utils/httpError.js';

export const SESSION_COOKIE = 'vkc_session';

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: env.isProduction,
    path: '/api',
    maxAge: 8 * 60 * 60 * 1000,
  };
}

export function issueSession(res, admin) {
  const token = jwt.sign({ sub: String(admin._id), ver: admin.tokenVersion }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
    issuer: 'vkc-keralotsavam',
    audience: 'vkc-admin',
  });
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
}

export function clearSession(res) {
  const { maxAge: _maxAge, ...options } = sessionCookieOptions();
  res.clearCookie(SESSION_COOKIE, options);
}

async function resolveAdmin(req) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, env.jwtSecret, { issuer: 'vkc-keralotsavam', audience: 'vkc-admin' });
    const admin = await AdminUser.findById(payload.sub);
    if (!admin || admin.tokenVersion !== payload.ver) return null;
    return admin;
  } catch {
    return null;
  }
}

export async function requireAdmin(req, res, next) {
  const admin = await resolveAdmin(req);
  if (!admin) {
    clearSession(res);
    return next(unauthorized());
  }
  req.admin = admin;
  return next();
}

/** In production an admin flagged for a password change may not use anything but the change-password endpoint. */
export function requirePasswordCurrent(req, _res, next) {
  if (env.isProduction && req.admin?.mustChangePassword) {
    return next(forbidden('You must change your password before continuing.'));
  }
  return next();
}
