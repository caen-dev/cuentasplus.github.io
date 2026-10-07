'use strict';

/**
 * DB.JS — IndexedDB Layer
 *
 * CONTRACT:
 * - DB version = 2
 * - Keep clientsStore keyPath = name
 * - Keep clients[name] as the in-memory access pattern
 * - V2 adds metadata and syncQueue stores
 * - Money migration normalizes records to monetary model V2
 * - Ambiguous monetary records are rejected and never written automatically
 */

import {
  ensureClientUUIDs,
  ensureTransactionUUIDs
} from './migration.js';

import {
  normalizeClientMoney
} from './moneyMigration.js';

export let db;
const DB_NAME = 'clientsDB';
const STORE = 'clientsStore';

export function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);

    request.onupgradeneeded = (e) => {
      db = e.target.result;

      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'name' });
      }

      if (!db.objectStoreNames.contains('metadata')) {
        db.createObjectStore('metadata', { keyPath: 'key' });
      }

      if (!db.objectStoreNames.contains('syncQueue')) {
        db.createObjectStore('syncQueue', { keyPath: 'id' });
      }
    };

    request.onsuccess = (e) => {
      db = e.target.result;

      db.onversionchange = () => {
        db.close();
        db = undefined;
      };

      resolve(db);
    };

    request.onerror = () =>
      reject(
        request.error ||
        new Error('No se pudo abrir la base de datos local.')
      );

    request.onblocked = () =>
      reject(
        new Error(
          'No se pudo abrir la base de datos porque otra pestaña la está usando.'
        )
      );
  });
}

/**
 * Normaliza identidad + dinero para una escritura.
 *
 * Todas las validaciones se ejecutan antes de abrir la transacción.
 * Esto evita escrituras parciales cuando un registro es ambiguo.
 */
function normalizeClientForWrite(client) {
  let normalized = normalizeClientMoney(client);

  normalized = ensureClientUUIDs(
    normalized,
    new Date().toISOString()
  );

  normalized.transactions = (normalized.transactions || []).map((txn) =>
    ensureTransactionUUIDs(
      txn,
      normalized.id,
      new Date().toISOString()
    )
  );

  normalized.updatedAt = new Date().toISOString();

  return normalized;
}

/**
 * Normaliza identidad + dinero al leer.
 *
 * No actualiza updatedAt porque simplemente cargar datos no es una edición.
 */
function normalizeClientForRead(client) {
  let normalized = ensureClientUUIDs(
    client,
    new Date().toISOString()
  );

  normalized = normalizeClientMoney(normalized);

  normalized.transactions = (normalized.transactions || []).map((txn) =>
    ensureTransactionUUIDs(
      txn,
      normalized.id,
      new Date().toISOString()
    )
  );

  return normalized;
}

export async function saveClient(client, previousName = null) {
  const normalized = normalizeClientForWrite(client);

  await runTransaction('readwrite', (store) => {
    if (
      previousName &&
      previousName !== normalized.name
    ) {
      store.delete(previousName);
    }

    store.put(normalized);
  });

  return normalized;
}
export function deleteClientByName(name) {
  return runTransaction(
    'readwrite',
    (store) => store.delete(name)
  );
}

export function saveClients(clients) {
  if (!clients.length) {
    return Promise.resolve();
  }

  /*
   * IMPORTANTE:
   * Normalizamos todos los clientes ANTES de iniciar la transacción.
   * Si uno es ambiguo o inválido, no se escribe ninguno.
   */
  const normalizedClients = clients.map(normalizeClientForWrite);

  return runTransaction('readwrite', (store) => {
    normalizedClients.forEach((client) => {
      store.put(client);
    });
  });
}

export function replaceAllClients(clients) {
  /*
   * IMPORTANTE:
   * La validación ocurre antes de store.clear().
   * Un backup con un registro ambiguo no puede borrar la base existente.
   */
  const normalizedClients = clients.map(normalizeClientForWrite);

  return runTransaction('readwrite', (store) => {
    store.clear();

    normalizedClients.forEach((client) => {
      store.put(client);
    });
  });
}

export function loadAllClients() {
  let rows = [];

  return runTransaction('readonly', (store) => {
    const request = store.getAll();

    request.onsuccess = () => {
      rows = request.result || [];
    };
  }).then(async () => {
    /*
     * Primero normalizamos TODOS los registros en memoria.
     *
     * Si alguno es ambiguo/inválido, la operación termina con error
     * antes de ejecutar cualquier escritura.
     */
    const normalizedRows = rows.map(normalizeClientForRead);

    const changed = normalizedRows.filter((client, index) => {
      const original = rows[index];
      return JSON.stringify(client) !== JSON.stringify(original);
    });

    if (changed.length) {
      await runTransaction('readwrite', (store) => {
        changed.forEach((client) => {
          store.put(client);
        });
      });
    }

    return normalizedRows;
  });
}

function runTransaction(mode, operation) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(
        new Error(
          'La base de datos local no está inicializada.'
        )
      );
      return;
    }

    let transaction;

    try {
      transaction = db.transaction(STORE, mode);
      operation(transaction.objectStore(STORE));
    } catch (error) {
      reject(error);
      return;
    }

    transaction.oncomplete = () => resolve();

    transaction.onerror = () =>
      reject(
        transaction.error ||
        new Error(
          'No se pudo completar la operación en la base de datos local.'
        )
      );

    transaction.onabort = () =>
      reject(
        transaction.error ||
        new Error(
          'La operación en la base de datos local fue cancelada.'
        )
      );
  });
}

