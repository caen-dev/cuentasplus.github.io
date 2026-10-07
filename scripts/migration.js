'use strict';

/**

* MIGRATION.JS — Phase 1: UUID Normalization
* 
* This module provides idempotent normalization functions to upgrade
* legacy Cuentas+ data to include:
* - UUID identifiers (client.id, transaction.id)
* - Global business ID (client.businessId, transaction.businessId)
* - Timestamp tracking (createdAt, updatedAt)
* - Transaction relationships (transaction.clientId)
* - Date field migration (date → occurredAt)
* 
* RULES:
* 1. All functions are idempotent: running twice produces the same result.
* 2. UUID generation happens once; existing UUIDs are preserved.
* 3. businessId is global per installation.
* 4. createdAt on legacy data is the migration timestamp.
* 5. updatedAt is only set/updated on write operations.
* 6. No fields are deleted; only new fields are added.
* 
* TEST/ENVIRONMENT RULE:
* localStorage is available in the browser, but Node.js tests do not
* provide it automatically. The fallback storage below keeps the module
* usable in non-browser environments without changing browser behavior.
  */

const BUSINESS_ID_KEY = 'cuentasplus:businessId';

let fallbackBusinessId = null;

/**

* Generates a UUID v4 using the Web Crypto API.
* 
* @returns {string} UUID v4 string
  */
  export function generateUUID() {
  return crypto.randomUUID();
  }

/**

* Returns a storage implementation when localStorage is available.
* 
* Browser:
* uses real localStorage.
* 
* Node/test:
* uses a small in-memory fallback.
* 
* @returns {Storage|object|null}
  */
  function getBusinessIdStorage() {
  try {
  if (
  typeof globalThis !== 'undefined' &&
  globalThis.localStorage &&
  typeof globalThis.localStorage.getItem === 'function' &&
  typeof globalThis.localStorage.setItem === 'function'
  ) {
  return globalThis.localStorage;
  }
  } catch (error) {
  // localStorage may exist but be inaccessible in restricted environments.
  }

return null;
}

/**

* Gets or creates a unique business ID for this installation.
* 
* Browser:
* Stored in localStorage so it survives page reloads.
* 
* Node/test:
* Stored in memory for the lifetime of the module.
* 
* @returns {string} UUID of the business
  */
  export function getOrCreateBusinessId() {
  const storage = getBusinessIdStorage();

if (storage) {
let businessId = storage.getItem(BUSINESS_ID_KEY);

if (!businessId) {
  businessId = generateUUID();
  storage.setItem(BUSINESS_ID_KEY, businessId);
}

return businessId;

}

if (!fallbackBusinessId) {
fallbackBusinessId = generateUUID();
}

return fallbackBusinessId;
}

/**

* Checks if a client object needs normalization.
* 
* A client is legacy when one or more migration fields are missing.
* 
* @param {object} client - Client object to check
* @returns {boolean} True if client is legacy/incomplete
  */
  export function detectLegacyClient(client) {
  if (!client) return false;

return (
!client.id ||
!client.businessId ||
!client.createdAt ||
!client.updatedAt
);
}

/**

* Normalizes a client object by adding UUID and timestamp fields.
* 
* IDEMPOTENT:
* - Existing client.id is preserved.
* - Existing createdAt is preserved.
* - Existing updatedAt is preserved.
* - Existing transaction IDs are preserved.
* - Existing occurredAt values are preserved.
* 
* @param {object} client - Client object from IndexedDB
* @param {string} migrationTimestamp - ISO 8601 timestamp
* @returns {object} Normalized client object
  */
  export function ensureClientUUIDs(
  client,
  migrationTimestamp = new Date().toISOString()
  ) {
  if (!client) return client;

const normalized = { ...client };

if (!normalized.id) {
normalized.id = generateUUID();
}

if (!normalized.businessId) {
  normalized.businessId = getOrCreateBusinessId();
}

if (!normalized.createdAt) {
normalized.createdAt = migrationTimestamp;
}

if (!normalized.updatedAt) {
normalized.updatedAt = migrationTimestamp;
}

if (Array.isArray(normalized.transactions)) {
normalized.transactions = normalized.transactions.map((txn) =>
ensureTransactionUUIDs(
txn,
normalized.id,
migrationTimestamp
)
);
} else {
normalized.transactions = [];
}

return normalized;
}

/**

* Normalizes a transaction object by adding UUID, relationships,
* business ID and timestamps.
* 
* @param {object} transaction - Transaction object
* @param {string} clientId - UUID of the client
* @param {string} migrationTimestamp - ISO 8601 timestamp
* @returns {object} Normalized transaction object
  */
  export function ensureTransactionUUIDs(
  transaction,
  clientId,
  migrationTimestamp = new Date().toISOString()
  ) {
  if (!transaction) return transaction;

const normalized = { ...transaction };

if (!normalized.id) {
normalized.id = generateUUID();
}

normalized.clientId = clientId;
if (!normalized.businessId) {
  normalized.businessId = getOrCreateBusinessId();
}

if (!normalized.occurredAt && normalized.date) {
normalized.occurredAt = normalized.date;
}

if (!normalized.createdAt) {
normalized.createdAt = migrationTimestamp;
}

if (!normalized.updatedAt) {
normalized.updatedAt = migrationTimestamp;
}

return normalized;
}

/**

* Checks whether a client or one of its transactions requires
* normalization.
* 
* @param {object} client - Client object
* @returns {boolean} True if normalization is required
  */
  export function clientNeedsNormalization(client) {
  if (!client) return false;

if (detectLegacyClient(client)) {
return true;
}

if (Array.isArray(client.transactions)) {
return client.transactions.some(
(txn) =>
!txn.id ||
!txn.clientId ||
!txn.businessId ||
!txn.createdAt ||
!txn.updatedAt ||
(!txn.occurredAt && txn.date)
);
}

return false;
}