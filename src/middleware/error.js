import multer from 'multer';
import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';

function formatZodIssues(error) {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

export function notFoundHandler(_req, res) {
  res.status(404).json({ message: 'Endpoint not found' });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(error, _req, res, _next) {
  if (error instanceof ZodError) {
    const issues = formatZodIssues(error);
    return res.status(400).json({ message: issues[0]?.message ?? 'Invalid input', issues });
  }
  if (error instanceof HttpError) {
    return res.status(error.status).json({ message: error.message, ...(error.details ? { issues: error.details } : {}) });
  }
  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_SIZE' ? 'One of the uploaded files is too large.' : 'Invalid file upload.';
    return res.status(400).json({ message });
  }
  if (error?.type === 'entity.too.large') return res.status(413).json({ message: 'Request is too large.' });
  if (error?.type === 'entity.parse.failed') return res.status(400).json({ message: 'Malformed JSON body.' });
  if (error?.name === 'CastError') return res.status(400).json({ message: 'Invalid identifier.' });
  if (error?.name === 'ValidationError') {
    return res.status(400).json({ message: Object.values(error.errors)[0]?.message ?? 'Validation failed' });
  }
  if (error?.code === 11000) return res.status(409).json({ message: 'A record with these details already exists.' });

  // Log only the error type and stack – never request bodies, which may contain personal data.
  console.error(`[error] ${error?.name ?? 'Error'}: ${error?.message}`);
  if (!env.isProduction && error?.stack) console.error(error.stack);
  return res.status(500).json({ message: 'Something went wrong. Please try again.' });
}
