import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { randomToken, safeEqual } from '../utils/crypto.js';
import { forbidden } from '../utils/httpError.js';

export const CSRF_COOKIE = 'vkc_csrf';
export const CSRF_HEADER = 'x-csrf-token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function sign(nonce) {
  return crypto.createHmac('sha256', env.jwtSecret).update(`csrf:${nonce}`).digest('base64url');
}

function isWellFormed(token) {
  if (typeof token !== 'string') return false;
  const [nonce, signature] = token.split('.');
  return Boolean(nonce && signature) && safeEqual(sign(nonce), signature);
}

/** Signed double-submit cookie. The cookie is readable by the SPA, which echoes it in a header. */
export function issueCsrfToken(req, res) {
  let token = req.cookies?.[CSRF_COOKIE];
  if (!isWellFormed(token)) {
    const nonce = randomToken(24);
    token = `${nonce}.${sign(nonce)}`;
  }
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    sameSite: 'strict',
    secure: env.isProduction,
    path: '/',
    maxAge: 12 * 60 * 60 * 1000,
  });
  res.json({ csrfToken: token });
}

export function verifyCsrf(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.get(CSRF_HEADER);
  if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken) || !isWellFormed(cookieToken)) {
    return next(forbidden('Invalid or missing CSRF token. Please refresh the page and try again.'));
  }
  return next();
}
