import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

const common = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => env.isTest,
  handler: (_req, res, _next, options) =>
    res.status(options.statusCode).json({ message: 'Too many requests. Please wait a moment and try again.' }),
};

export const apiLimiter = rateLimit({ ...common, windowMs: 15 * 60 * 1000, limit: 600 });
export const loginLimiter = rateLimit({ ...common, windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true });
export const registrationLimiter = rateLimit({ ...common, windowMs: 60 * 60 * 1000, limit: 30 });
export const exportLimiter = rateLimit({ ...common, windowMs: 10 * 60 * 1000, limit: 40 });
