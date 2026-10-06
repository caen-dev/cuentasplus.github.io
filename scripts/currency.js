'use strict';

/**
 * CURRENCY.JS — Single source of truth for all monetary conversions
 *
 * This module MUST be the only place in the codebase that:
 * - Parses user input strings (e.g., "1.50" or "1,50") to cents
 * - Formats cents for display (e.g., 150 → "$1,50")
 * - Performs monetary arithmetic
 *
 * All other modules MUST work exclusively with integer cents.
 * Database storage (IndexedDB, Supabase) uses cents as BIGINT.
 *
 * Architecture:
 * UI string → parseMoneyToCents() → integer cents
 * ↓
 * [All calculations with integers - NO FLOATING POINT]
 * ↓
 * integer cents → formatMoneyFromCents() → UI string
 */

// =====================================================================
// CONFIGURATION
// =====================================================================

/**
 * Currency configuration. ARS only at this stage.
 * Structure prepared for future multi-currency support without breaking changes.
 */
const CURRENCY_CONFIG = {
  ARS: {
    code: 'ARS',
    symbol: '$',
    decimals: 2,
    locale: 'es-AR',
    name: 'Peso Argentino'
  }
};

const DEFAULT_CURRENCY = 'ARS';

// Maximum monetary value accepted by the application.
// ARS 9.999.999.999,99 = 999.999.999.999 cents.
export const MAX_MONEY_CENTS = 999999999999;

// =====================================================================
// PARSING: String → Integer Cents
// =====================================================================

/**
 * Parses a monetary string input to cents (integer).
 *
 * Accepts both formats:
 * - Dot as decimal: "1.50", "1000.99"
 * - Comma as decimal: "1,50", "1.000,99" (European format)
 *
 * @param {string|number|null|undefined} value - User input
 * @returns {number} Integer cents, or NaN if invalid
 *
 * Examples:
 *   parseMoneyToCents("1.50")      → 150
 *   parseMoneyToCents("1,50")      → 150
 *   parseMoneyToCents("1000.99")   → 100099
 *   parseMoneyToCents("1.000,99")  → 100099
 *   parseMoneyToCents("abc")       → NaN
 *   parseMoneyToCents("")          → NaN
 *   parseMoneyToCents(null)        → NaN
 */
export function parseMoneyToCents(value) {
  if (value === null || value === undefined || value === '') {
    return NaN;
  }

  const str = String(value).trim();

  if (!str) {
    return NaN;
  }

  const toCents = (number) => {
    if (!Number.isFinite(number) || number < 0) {
      return NaN;
    }

    const cents = Math.round(number * 100);

    if (!Number.isSafeInteger(cents) || cents > MAX_MONEY_CENTS) {
      return NaN;
    }

    return cents;
  };

  // Pattern 1: Dot as decimal (US/UK format): "1.50" or "1000.99"
  const dotDecimalPattern = /^\d+\.\d{1,2}$/;
  if (dotDecimalPattern.test(str)) {
    return toCents(Number(str));
  }

  // Pattern 2: Comma as decimal, dots as thousands (European format): "1.000,99"
  const commaDecimalPattern = /^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/;
  if (commaDecimalPattern.test(str)) {
    const normalized = str.replace(/\./g, '').replace(',', '.');
    return toCents(Number(normalized));
  }

  // Pattern 3: Plain integer: "150" or "1000"
  const integerPattern = /^\d+$/;
  if (integerPattern.test(str)) {
    return toCents(Number(str));
  }

  // Invalid format
  return NaN;
}

// =====================================================================
// FORMATTING: Integer Cents → Display String
// =====================================================================

/**
 * Formats integer cents to a display string (e.g., 150 → "$1,50").
 *
 * @param {number} cents - Integer cents to format
 * @param {string} currency - Currency code (default: ARS)
 * @returns {string} Formatted string, e.g., "$1,50" or "$1.000,99"
 *
 * Examples:
 *   formatMoneyFromCents(150)     → "$1,50"
 *   formatMoneyFromCents(0)       → "$0,00"
 *   formatMoneyFromCents(100099)  → "$1.000,99"
 *   formatMoneyFromCents(NaN)     → "$0,00"
 */
export function formatMoneyFromCents(cents, currency = DEFAULT_CURRENCY) {
  if (!Number.isFinite(cents)) {
    return '$0,00';
  }

  const config = CURRENCY_CONFIG[currency] || CURRENCY_CONFIG[DEFAULT_CURRENCY];
  const divisor = Math.pow(10, config.decimals);
  const number = Math.round(cents) / divisor;

  const formatted = new Intl.NumberFormat(config.locale, {
    minimumFractionDigits: config.decimals,
    maximumFractionDigits: config.decimals
  }).format(number);

  return `${config.symbol}${formatted}`;
}

// =====================================================================
// LIVE FORMATTING: For input fields (user typing)
// =====================================================================

/**
 * Formats money input as the user types (live feedback).
 *
 * Rules:
 * - Accepts both dot and comma as decimal separator
 * - Adds thousands separators (dots in es-AR format)
 * - Limits to 2 decimal places
 * - Does NOT convert to cents; returns formatted display string
 * - Does NOT validate; used for UX while typing
 *
 * @param {string} raw - Unprocessed input
 * @returns {string} Formatted for display (not validated)
 *
 * Examples:
 *   formatMoneyLive("1500")  → "1.500"
 *   formatMoneyLive("1,5")   → "1,5"
 *   formatMoneyLive("150")   → "150"
 *   formatMoneyLive("")      → ""
 *   formatMoneyLive("abc1")  → "abc1" (rejected, no change)
 */
export function formatMoneyLive(raw) {
  const value = String(raw ?? '');

  if (!value) {
    return '';
  }

  // Reject if contains invalid characters (not digit, dot, or comma)
  if (/[^0-9.,]/.test(value)) {
    return value; // Return as-is for user to correct
  }

  // Reject if contains multiple commas
  const commaCount = (value.match(/,/g) || []).length;
  if (commaCount > 1) {
    return value; // Invalid, no formatting
  }

  // Reject if decimal part exceeds 2 digits
  const commaIndex = value.indexOf(',');
  if (commaIndex >= 0 && value.length - commaIndex - 1 > 2) {
    return value; // Invalid, no formatting
  }

  // Process: remove dots (thousands separators), split on comma
  let processed = value.replace(/\./g, '');
  const parts = processed.split(',');
  let intPart = parts[0] || '';
  let decPart = (parts[1] || '').slice(0, 2);

  // Remove leading zeros from integer part
  intPart = intPart.replace(/^0+(?=\d)/, '');
  if (!intPart) {
    intPart = '0';
  }

  // Add thousands separators (dots for es-AR)
  intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  // Reconstruct with or without decimal part
  return value.includes(',') ? `${intPart},${decPart}` : intPart;
}

// =====================================================================
// ARITHMETIC: Integer operations (no floating point)
// =====================================================================

/**
 * Adds two monetary amounts in cents (exact arithmetic).
 *
 * @param {number} cents1 - First amount (integer cents)
 * @param {number} cents2 - Second amount (integer cents)
 * @returns {number} Sum in cents (integer)
 *
 * Example:
 *   addCents(150, 250) → 400
 */
export function addCents(cents1, cents2) {
  const a = Math.round(cents1);
  const b = Math.round(cents2);
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return NaN;
  }
  return a + b;
}

/**
 * Subtracts two monetary amounts in cents (exact arithmetic).
 *
 * @param {number} minuend - Amount to subtract from (integer cents)
 * @param {number} subtrahend - Amount to subtract (integer cents)
 * @returns {number} Difference in cents (integer)
 *
 * Example:
 *   subtractCents(1000, 350) → 650
 */
export function subtractCents(minuend, subtrahend) {
  const a = Math.round(minuend);
  const b = Math.round(subtrahend);
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return NaN;
  }
  return a - b;
}

/**
 * Multiplies a monetary amount by a scalar (for splits, taxes, etc.).
 *
 * @param {number} cents - Base amount (integer cents)
 * @param {number} scalar - Multiplier (e.g., 0.5, 1.1, 2)
 * @returns {number} Product in cents (integer, rounded)
 *
 * Example:
 *   multiplyCents(1000, 0.5) → 500
 *   multiplyCents(1000, 1.1) → 1100
 */
export function multiplyCents(cents, scalar) {
  const c = Math.round(cents);
  const s = Number(scalar);
  if (!Number.isFinite(c) || !Number.isFinite(s)) {
    return NaN;
  }
  return Math.round(c * s);
}

/**
 * Ensures a value is valid cents (integer, non-negative, finite).
 *
 * @param {number} cents - Value to validate
 * @returns {boolean} True if valid cents
 *
 * Example:
 *   isValidCents(150)   → true
 *   isValidCents(-10)   → false
 *   isValidCents(NaN)   → false
 *   isValidCents(15.5)  → true (rounds to 16)
 */
export function isValidCents(cents) {
  const rounded = Math.round(cents);
  return Number.isFinite(rounded) && rounded >= 0;
}

/**
 * Clamps cents to a maximum value.
 *
 * @param {number} cents - Amount to clamp
 * @param {number} maxCents - Maximum allowed (inclusive)
 * @returns {number} Clamped value in cents
 *
 * Example:
 *   clampCents(1500, 1000) → 1000
 */
export function clampCents(cents, maxCents) {
  const c = Math.round(cents);
  const max = Math.round(maxCents);
  if (!Number.isFinite(c) || !Number.isFinite(max)) {
    return NaN;
  }
  return Math.min(c, max);
}

// =====================================================================
// CURRENCY INFO
// =====================================================================

/**
 * Gets the configuration for a currency.
 *
 * @param {string} currency - Currency code (default: ARS)
 * @returns {object} Configuration object (code, symbol, decimals, locale, name)
 */
export function getCurrencyConfig(currency = DEFAULT_CURRENCY) {
  return (
    CURRENCY_CONFIG[currency] ||
    CURRENCY_CONFIG[DEFAULT_CURRENCY]
  );
}

/**
 * Gets the default currency code.
 *
 * @returns {string} Currency code (e.g., "ARS")
 */
export function getDefaultCurrency() {
  return DEFAULT_CURRENCY;
}

/**
 * Lists all supported currencies.
 *
 * @returns {string[]} Array of currency codes
 */
export function getSupportedCurrencies() {
  return Object.keys(CURRENCY_CONFIG);
}

// =====================================================================
// VALIDATION & NORMALIZATION
// =====================================================================

/**
 * Validates a monetary string without converting it.
 *
 * @param {string} value - Input to validate
 * @returns {boolean} True if the string can be parsed to valid cents
 *
 * Example:
 *   isValidMoneyString("1.50")   → true
 *   isValidMoneyString("1,50")   → true
 *   isValidMoneyString("abc")    → false
 *   isValidMoneyString("-10")    → false
 */
export function isValidMoneyString(value) {
  return Number.isFinite(parseMoneyToCents(value));
}

/**
 * Normalizes a monetary string to standard format for internal use.
 * Converts both "1.50" and "1,50" to cents, then back to standard string.
 *
 * @param {string} value - Input (can be in either format)
 * @returns {string} Normalized format (e.g., "$1,50") or error message
 *
 * Example:
 *   normalizeMoneyString("1.50")   → "$1,50"
 *   normalizeMoneyString("1,50")   → "$1,50"
 *   normalizeMoneyString("abc")    → "$0,00" (invalid input)
 */
export function normalizeMoneyString(value) {
  const cents = parseMoneyToCents(value);
  return formatMoneyFromCents(cents);
}
