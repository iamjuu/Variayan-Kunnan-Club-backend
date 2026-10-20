import fs from 'node:fs';
import path from 'node:path';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { apiLimiter } from './middleware/rateLimits.js';
import { sanitizeBody } from './middleware/sanitize.js';
import { adminRouter } from './routes/admin.js';
import { authRouter } from './routes/auth.js';
import { publicRouter } from './routes/public.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (env.trustProxy) app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          scriptSrc: ["'self'"],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-origin' },
    }),
  );
  app.use(compression());

  // Log method, path (without query string), status and timing only – never bodies or query values.
  if (!env.isTest) {
    morgan.token('path', (req) => req.originalUrl.split('?')[0]);
    app.use(morgan(':method :path :status :response-time ms'));
  }

  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(cookieParser());
  app.use(sanitizeBody);

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api', apiLimiter);
  app.use('/api/auth', authRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api', publicRouter);
  app.use('/api', notFoundHandler);

  if (env.serveClient && fs.existsSync(env.clientDist)) {
    app.use(express.static(env.clientDist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(env.clientDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
