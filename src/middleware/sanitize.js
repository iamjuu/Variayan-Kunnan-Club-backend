// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * Strips MongoDB operator keys ($...) and dotted keys, and removes control characters from
 * strings, so that user-supplied objects can never be interpreted as query operators.
 */
export function deepSanitize(value, depth = 0) {
  if (depth > 12) return undefined;
  if (typeof value === 'string') return value.replace(CONTROL_CHARS, '');
  if (Array.isArray(value)) return value.map((v) => deepSanitize(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      if (key.startsWith('$') || key.includes('.') || key === '__proto__' || key === 'constructor') continue;
      out[key] = deepSanitize(v, depth + 1);
    }
    return out;
  }
  return value;
}

export function sanitizeBody(req, _res, next) {
  if (req.body && typeof req.body === 'object') req.body = deepSanitize(req.body);
  next();
}
