/**
 * Lucrari — Shared Fail-Closed Validation Utilities
 * 
 * Centralized, deterministic validators for:
 * - RFC4122 v4 UUIDs
 * - PostgreSQL timestamptz ISO-8601 strings with explicit timezone offsets
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMPTZ_REGEX = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}(?::?\d{2})?)$/;

/**
 * Strict validator for UUID format.
 */
export function isValidUUID(val: unknown): val is string {
  if (typeof val !== 'string' || !val.trim()) return false;
  return UUID_REGEX.test(val.trim());
}

/**
 * Strict validator for PostgreSQL timestamptz ISO-8601 strings.
 * Requires full date, time (T), and timezone indicator (Z or +/-HH:MM).
 * Validates real calendar days (rejects invalid dates like 2026-02-30).
 */
export function isValidIsoTimestampWithTimezone(val: unknown): val is string {
  if (typeof val !== 'string' || !val.trim()) return false;
  const str = val.trim();
  const match = ISO_TIMESTAMPTZ_REGEX.exec(str);
  if (!match) return false;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const hour = parseInt(match[4], 10);
  const min = parseInt(match[5], 10);
  const sec = parseInt(match[6], 10);

  if (month < 1 || month > 12) return false;
  if (hour < 0 || hour > 23 || min < 0 || min > 59 || sec < 0 || sec > 59) return false;

  const utcDate = new Date(Date.UTC(year, month - 1, day));
  if (
    utcDate.getUTCFullYear() !== year ||
    utcDate.getUTCMonth() !== month - 1 ||
    utcDate.getUTCDate() !== day
  ) {
    return false;
  }

  const timestamp = Date.parse(str);
  return Number.isFinite(timestamp);
}
