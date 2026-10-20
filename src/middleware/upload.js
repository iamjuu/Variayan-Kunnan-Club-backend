import multer from 'multer';
import { env } from '../config/env.js';
import { GALLERY_TYPES } from '../services/galleryStorage.js';
import { sniffMimeType } from '../services/fileStorage.js';
import { badRequest } from '../utils/httpError.js';

export const MAX_GROUP_MEMBERS = 40;
const FIELD_PATTERN = /^(participantPhoto|aadhaarDocument|memberPhoto_(\d{1,2}))$/;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png']);
const DOCUMENT_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf']);

const multerInstance = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Math.max(env.maxPhotoBytes, env.maxDocumentBytes),
    files: MAX_GROUP_MEMBERS + 2,
    fields: 5,
    fieldSize: 512 * 1024,
    parts: MAX_GROUP_MEMBERS + 10,
  },
  fileFilter(_req, file, cb) {
    if (!FIELD_PATTERN.test(file.fieldname)) return cb(badRequest(`Unexpected file field: ${file.fieldname}`));
    return cb(null, true);
  },
});

/** Parses multipart registration uploads and validates each file by its magic bytes and size. */
export function registrationUpload(req, res, next) {
  multerInstance.any()(req, res, (error) => {
    if (error) return next(error);
    const files = {};
    try {
      for (const file of req.files ?? []) {
        if (files[file.fieldname]) throw badRequest(`Duplicate file for ${file.fieldname}`);
        const detected = sniffMimeType(file.buffer);
        const isDocument = file.fieldname === 'aadhaarDocument';
        const allowed = isDocument ? DOCUMENT_TYPES : IMAGE_TYPES;
        if (!detected || !allowed.has(detected)) {
          throw badRequest(
            isDocument
              ? 'Aadhaar document must be a JPG, PNG or PDF file.'
              : 'Passport photos must be JPG or PNG images.',
          );
        }
        const maxBytes = isDocument ? env.maxDocumentBytes : env.maxPhotoBytes;
        if (file.size > maxBytes) {
          throw badRequest(`${isDocument ? 'Document' : 'Photo'} must be smaller than ${Math.round(maxBytes / 1048576)} MB.`);
        }
        files[file.fieldname] = { buffer: file.buffer, mimeType: detected, size: file.size };
      }
    } catch (validationError) {
      return next(validationError);
    }
    req.uploadedFiles = files;
    return next();
  });
}

const galleryMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxGalleryBytes, files: 12, fields: 8, fieldSize: 32 * 1024 },
  fileFilter(_req, file, cb) {
    if (file.fieldname !== 'images' && file.fieldname !== 'image') {
      return cb(badRequest(`Unexpected file field: ${file.fieldname}`));
    }
    return cb(null, true);
  },
});

/** Club gallery photos are public (not encrypted). Validated by magic bytes. */
export function galleryUpload(req, res, next) {
  galleryMulter.any()(req, res, (error) => {
    if (error) return next(error);
    const files = [];
    try {
      for (const file of req.files ?? []) {
        const detected = sniffMimeType(file.buffer);
        if (!detected || !GALLERY_TYPES.has(detected)) {
          throw badRequest('Gallery photos must be JPG, PNG or WebP images.');
        }
        if (file.size > env.maxGalleryBytes) {
          throw badRequest(`Each gallery photo must be smaller than ${Math.round(env.maxGalleryBytes / 1048576)} MB.`);
        }
        files.push({ buffer: file.buffer, mimeType: detected, size: file.size, originalName: file.originalname });
      }
    } catch (validationError) {
      return next(validationError);
    }
    req.galleryFiles = files;
    return next();
  });
}
