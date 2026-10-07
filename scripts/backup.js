'use strict';

import { isValidCents } from './currency.js';

/**
 * BACKUP.JS
 *
 * Contrato monetario de backups:
 *
 * V2:
 * - version: 2
 * - moneyModelVersion: 2
 * - money: { currency: 'ARS', unit: 'cent', decimals: 2 }
 * - balanceCents: entero >= 0
 * - transaction.amountCents: entero > 0
 *
 * IMPORTANTE:
 * No existe ninguna heurística basada en el tamaño del número.
 *
 * Un valor V1 solamente puede migrarse mediante migrateBackupV1()
 * indicando explícitamente si sus valores están expresados en
 * 'pesos' o 'centavos'.
 */

const BACKUP_FORMAT = 'cuentasplus-backup';
const BACKUP_VERSION = 2;
const MONEY_MODEL_VERSION = 2;
const MONEY_CONFIG = Object.freeze({
  currency: 'ARS',
  unit: 'cent',
  decimals: 2
});

/**
 * Valida exclusivamente backups V2.
 *
 * No convierte valores legacy.
 * No interpreta balance/amount.
 * No utiliza heurísticas.
 *
 * @param {object} data
 * @returns {{ business: object, clients: Array }}
 * @throws {Error}
 */
export function validateBackup(data) {
  validateBackupEnvelope(data);

  if (data.version !== BACKUP_VERSION) {
    if (data.version === 1) {
      throw new Error(
        'La copia es V1 y requiere una migracion monetaria explicita con una unidad declarada.'
      );
    }

    throw new Error(
      'La version de la copia no es compatible con esta version de Cuentas+.'
    );
  }

  validateMoneyContract(data);

  return normalizeV2Backup(data);
}

/**
 * Migra explícitamente un backup V1 a V2.
 *
 * unit debe ser:
 * - 'pesos'
 * - 'centavos'
 *
 * Nunca se infiere la unidad por el tamaño del valor.
 *
 * @param {object} data
 * @param {'pesos'|'centavos'} unit
 * @returns {object} Backup V2
 */
export function migrateBackupV1(data, unit) {
  if (unit !== 'pesos' && unit !== 'centavos') {
    throw new Error(
      "La unidad de migracion V1 debe ser 'pesos' o 'centavos'."
    );
  }

  validateBackupEnvelope(data);

  if (data.version !== 1) {
    if (data.version === 2) {
      return data;
    }

    throw new Error(
      'Solo se puede migrar explicitamente un backup V1.'
    );
  }

  if (!Array.isArray(data.clients)) {
    throw new Error('La copia no contiene una lista valida de clientes.');
  }

  if (!data.business || typeof data.business !== 'object') {
    throw new Error('La copia no contiene datos validos del negocio.');
  }

  validateBusinessInfo(data.business);

  const names = new Set();

  const clients = data.clients.map((clientData) => {
    validateLegacyClientShape(clientData);

    const name = clientData.name.trim();

    if (names.has(name)) {
      throw new Error(`La copia contiene clientes duplicados: "${name}".`);
    }

    names.add(name);

    if (
      Object.prototype.hasOwnProperty.call(clientData, 'balance') &&
      Object.prototype.hasOwnProperty.call(clientData, 'balanceCents')
    ) {
      throw new Error(
        `El cliente "${name}" contiene balance y balanceCents simultaneamente. La unidad es ambigua.`
      );
    }

    if (!Object.prototype.hasOwnProperty.call(clientData, 'balance')) {
      throw new Error(
        `El cliente "${name}" no contiene el saldo legacy "balance".`
      );
    }

    const balanceCents = convertLegacyMoney(
      clientData.balance,
      unit,
      `saldo de "${name}"`
    );

    if (balanceCents < 0) {
      throw new Error(`El saldo de "${name}" no puede ser negativo.`);
    }

    if (!Array.isArray(clientData.transactions)) {
      throw new Error(
        `Las transacciones de "${name}" no tienen un formato valido.`
      );
    }

    const transactions = clientData.transactions.map((txnData, txnIndex) => {
      if (!txnData || typeof txnData !== 'object') {
        throw new Error(
          `La copia contiene una transaccion invalida para "${name}".`
        );
      }

      if (
        Object.prototype.hasOwnProperty.call(txnData, 'amount') &&
        Object.prototype.hasOwnProperty.call(txnData, 'amountCents')
      ) {
        throw new Error(
          `La transaccion ${txnIndex} de "${name}" contiene amount y amountCents simultaneamente. La unidad es ambigua.`
        );
      }

      if (!Object.prototype.hasOwnProperty.call(txnData, 'amount')) {
        throw new Error(
          `La transaccion ${txnIndex} de "${name}" no contiene el monto legacy "amount".`
        );
      }

      validateTransactionType(txnData.type, name, txnIndex);
      validateTransactionDate(txnData.date, name, txnIndex);

      const amountCents = convertLegacyMoney(
        txnData.amount,
        unit,
        `monto de "${name}" (transaccion ${txnIndex})`
      );

      if (amountCents <= 0) {
        throw new Error(
          `La copia contiene un monto invalido o no positivo para "${name}" (transaccion ${txnIndex}).`
        );
      }

      return {
        type: normalizeTransactionType(txnData.type),
        amountCents,
        amount: amountCents,
        date: txnData.date.trim(),
        paymentMethod: typeof txnData.paymentMethod === 'string'
          ? txnData.paymentMethod.trim()
          : '-'
      };
    });

    return {
      name,
      phone: typeof clientData.phone === 'string'
        ? clientData.phone.trim()
        : '-',
      street: typeof clientData.street === 'string'
        ? clientData.street.trim()
        : '-',
      number: typeof clientData.number === 'string'
        ? clientData.number.trim()
        : '-',
      balance: balanceCents,
      balanceCents,
      transactions
    };
  });

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    moneyModelVersion: MONEY_MODEL_VERSION,
    money: { ...MONEY_CONFIG },
    exportedAt: typeof data.exportedAt === 'string'
      ? data.exportedAt
      : new Date().toISOString(),
    business: {
      name: data.business.name.trim(),
      phone: data.business.phone.trim(),
      address: data.business.address.trim()
    },
    clients
  };
}

/**
 * Valida la estructura básica del archivo.
 */
function validateBackupEnvelope(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('El archivo no es una copia valida de Cuentas+.');
  }

  if (data.format !== BACKUP_FORMAT) {
    throw new Error(
      'El archivo no es una copia valida de Cuentas+ (formato no reconocido).'
    );
  }
}

/**
 * Valida el contrato monetario V2.
 */
function validateMoneyContract(data) {
  if (data.moneyModelVersion !== MONEY_MODEL_VERSION) {
    throw new Error(
      'El backup V2 requiere moneyModelVersion: 2.'
    );
  }

  if (!data.money || typeof data.money !== 'object') {
    throw new Error(
      'El backup V2 requiere un contrato monetario explicito.'
    );
  }

  if (data.money.currency !== MONEY_CONFIG.currency) {
    throw new Error(
      `La moneda del backup no es compatible. Se esperaba ${MONEY_CONFIG.currency}.`
    );
  }

  if (data.money.unit !== MONEY_CONFIG.unit) {
    throw new Error(
      'La unidad monetaria del backup debe ser "cent".'
    );
  }

  if (data.money.decimals !== MONEY_CONFIG.decimals) {
    throw new Error(
      'La cantidad de decimales monetarios del backup debe ser 2.'
    );
  }
}

/**
 * Normaliza y valida un backup V2.
 */
function normalizeV2Backup(data) {
  if (!Array.isArray(data.clients)) {
    throw new Error('La copia no contiene una lista valida de clientes.');
  }

  if (!data.business || typeof data.business !== 'object') {
    throw new Error('La copia no contiene datos validos del negocio.');
  }

  validateBusinessInfo(data.business);

  const names = new Set();

  const clients = data.clients.map((clientData) => {
    if (!clientData || typeof clientData !== 'object') {
      throw new Error('La copia contiene un cliente invalido.');
    }

    if (typeof clientData.name !== 'string' || !clientData.name.trim()) {
      throw new Error('La copia contiene un cliente sin nombre valido.');
    }

    const name = clientData.name.trim();

    if (names.has(name)) {
      throw new Error(`La copia contiene clientes duplicados: "${name}".`);
    }

    names.add(name);

    if (
      Object.prototype.hasOwnProperty.call(clientData, 'balance') &&
      !Object.prototype.hasOwnProperty.call(clientData, 'balanceCents')
    ) {
      throw new Error(
        `El cliente "${name}" debe utilizar balanceCents en el backup V2.`
      );
    }

    if (!Object.prototype.hasOwnProperty.call(clientData, 'balanceCents')) {
      throw new Error(
        `El cliente "${name}" no contiene balanceCents.`
      );
    }

    const balanceCents = validateIntegerCents(
      clientData.balanceCents,
      `saldo de "${name}"`,
      false
    );

    if (!Array.isArray(clientData.transactions)) {
      throw new Error(
        `Las transacciones de "${name}" no tienen un formato valido.`
      );
    }

    const transactions = clientData.transactions.map((txnData, txnIndex) => {
      if (!txnData || typeof txnData !== 'object') {
        throw new Error(
          `La copia contiene una transaccion invalida para "${name}".`
        );
      }

      if (
        Object.prototype.hasOwnProperty.call(txnData, 'amount') &&
        Object.prototype.hasOwnProperty.call(txnData, 'amountCents')
      ) {
        throw new Error(
          `La transaccion ${txnIndex} de "${name}" contiene amount y amountCents simultaneamente.`
        );
      }

      if (Object.prototype.hasOwnProperty.call(txnData, 'amount')) {
        throw new Error(
          `La transaccion ${txnIndex} de "${name}" debe utilizar amountCents en el backup V2.`
        );
      }

      if (!Object.prototype.hasOwnProperty.call(txnData, 'amountCents')) {
        throw new Error(
          `La transaccion ${txnIndex} de "${name}" no contiene amountCents.`
        );
      }

      validateTransactionType(txnData.type, name, txnIndex);
      validateTransactionDate(txnData.date, name, txnIndex);

      const amountCents = validateIntegerCents(
        txnData.amountCents,
        `monto de "${name}" (transaccion ${txnIndex})`,
        true
      );

      return {
        type: normalizeTransactionType(txnData.type),
        amountCents,
        amount: amountCents,
        date: txnData.date.trim(),
        paymentMethod: typeof txnData.paymentMethod === 'string'
          ? txnData.paymentMethod.trim()
          : '-'
      };
    });

    return {
      name,
      phone: typeof clientData.phone === 'string'
        ? clientData.phone.trim()
        : '-',
      street: typeof clientData.street === 'string'
        ? clientData.street.trim()
        : '-',
      number: typeof clientData.number === 'string'
        ? clientData.number.trim()
        : '-',
      balanceCents,
      transactions
    };
  });

  return {
    business: {
      name: data.business.name.trim(),
      phone: data.business.phone.trim(),
      address: data.business.address.trim()
    },
    clients
  };
}

/**
 * Valida un monto V2 expresado explícitamente en centavos.
 */
function validateIntegerCents(value, fieldName, mustBePositive) {
  if (!isValidCents(value)) {
    throw new Error(
      `El ${fieldName} debe ser un numero entero de centavos dentro del rango monetario permitido.`
    );
  }

  if (mustBePositive && value <= 0) {
    throw new Error(
      `El ${fieldName} debe ser mayor que cero.`
    );
  }

  return value;
}

/**
 * Convierte explícitamente un valor V1 según la unidad declarada.
 *
 * pesos:
 *   150       -> 15000
 *   12.5      -> 1250
 *   "12.5"    -> 1250
 *   "1.234,56" -> 123456
 *
 * centavos:
 *   150       -> 150
 *   "150"     -> 150
 *
 * Un decimal expresado en centavos se rechaza.
 */
function convertLegacyMoney(value, unit, fieldName) {
  if (value === null || value === undefined || value === '') {
    throw new Error(`El ${fieldName} no contiene un valor monetario valido.`);
  }

  if (typeof value === 'boolean') {
    throw new Error(`El ${fieldName} no contiene un valor monetario valido.`);
  }

  if (unit === 'centavos') {
    if (typeof value === 'number') {
      if (!isValidCents(value)) {
        throw new Error(
          `El ${fieldName} debe ser un numero entero de centavos dentro del rango monetario permitido.`
        );
      }

      return value;
    }

    if (typeof value !== 'string') {
      throw new Error(`El ${fieldName} no contiene un valor monetario valido.`);
    }

    const text = value.trim();

    if (!/^\d+$/.test(text)) {
      throw new Error(
        `El ${fieldName} debe ser un numero entero de centavos.`
      );
    }

    const cents = Number(text);

    if (!isValidCents(cents)) {
      throw new Error(
        `El ${fieldName} debe ser un numero entero de centavos dentro del rango monetario permitido.`
      );
    }

    return cents;
  }

  if (unit === 'pesos') {
    let normalizedText;

    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`El ${fieldName} no contiene un valor monetario valido.`);
      }

      const cents = Math.round(value * 100);

      if (!isValidCents(cents)) {
        throw new Error(
          `El ${fieldName} excede el rango monetario permitido.`
        );
      }

      return cents;
    }

    if (typeof value !== 'string') {
      throw new Error(`El ${fieldName} no contiene un valor monetario valido.`);
    }

    normalizedText = value.trim();

    if (!normalizedText) {
      throw new Error(`El ${fieldName} no contiene un valor monetario valido.`);
    }

    /*
     * Acepta:
     * 1234.56
     * 1234,56
     * 1.234,56
     * 1.234
     *
     * Para strings argentinos con punto de miles y coma decimal,
     * se eliminan los separadores de miles y se normaliza la coma.
     */
    if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(normalizedText)) {
      normalizedText = normalizedText
        .replace(/\./g, '')
        .replace(',', '.');
    } else if (/^\d+,\d+$/.test(normalizedText)) {
      normalizedText = normalizedText.replace(',', '.');
    } else if (!/^\d+(?:\.\d+)?$/.test(normalizedText)) {
      throw new Error(
        `El ${fieldName} no contiene un formato de pesos valido.`
      );
    }

    const pesos = Number(normalizedText);

    if (!Number.isFinite(pesos) || pesos < 0) {
      throw new Error(`El ${fieldName} no contiene un valor monetario valido.`);
    }

    const cents = Math.round(pesos * 100);

    if (!isValidCents(cents)) {
      throw new Error(
        `El ${fieldName} excede el rango monetario permitido.`
      );
    }

    return cents;
  }

  throw new Error(
    "La unidad de migracion V1 debe ser 'pesos' o 'centavos'."
  );
}

function validateBusinessInfo(business) {
  for (const field of ['name', 'phone', 'address']) {
    if (typeof business[field] !== 'string') {
      throw new Error(
        `La copia no contiene el campo de negocio '${field}' en un formato valido.`
      );
    }
  }
}

function validateLegacyClientShape(clientData) {
  if (!clientData || typeof clientData !== 'object') {
    throw new Error('La copia contiene un cliente invalido.');
  }

  if (typeof clientData.name !== 'string' || !clientData.name.trim()) {
    throw new Error('La copia contiene un cliente sin nombre valido.');
  }
}

function validateTransactionType(type, name, txnIndex) {
  if (!['purchase', 'payment', 'Compra', 'Pago'].includes(type)) {
    throw new Error(
      `La copia contiene una transaccion con tipo invalido para "${name}" (posicion ${txnIndex}).`
    );
  }
}

function validateTransactionDate(date, name, txnIndex) {
  if (typeof date !== 'string' || !date.trim()) {
    throw new Error(
      `La copia contiene una fecha vacia para "${name}" (transaccion ${txnIndex}).`
    );
  }
}

function normalizeTransactionType(type) {
  return type === 'Compra'
    ? 'purchase'
    : type === 'Pago'
      ? 'payment'
      : type;
}

/**
 * Validates that a backup can be safely restored to the current app state.
 *
 * @param {object} validatedBackup - Result from validateBackup()
 * @returns {{ isValid: boolean, warnings: string[], errors: string[] }}
 */
export function preFlightCheckBackup(validatedBackup) {
  const warnings = [];
  const errors = [];

  if (!validatedBackup || !Array.isArray(validatedBackup.clients)) {
    errors.push('La copia validada no tiene estructura correcta.');
    return { isValid: false, warnings, errors };
  }

  const totalTransactions = validatedBackup.clients.reduce(
    (sum, client) => sum + (client.transactions || []).length,
    0
  );

  if (totalTransactions > 10000) {
    warnings.push(
      `La copia contiene ${totalTransactions} movimientos. La restauracion puede tomar unos segundos.`
    );
  }

  for (const client of validatedBackup.clients) {
    if (client.balance > 999999999) {
      warnings.push(
        `El cliente "${client.name}" tiene un saldo muy alto. Verifica que sea correcto.`
      );
    }
  }

  return {
    isValid: errors.length === 0,
    warnings,
    errors
  };
}

/**
 * Creates a V2 backup.
 *
 * The exported file contains only explicit monetary fields:
 * - balanceCents
 * - amountCents
 */
export function createBackupObject(businessInfo, clients) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    moneyModelVersion: MONEY_MODEL_VERSION,
    money: { ...MONEY_CONFIG },
    exportedAt: new Date().toISOString(),
    business: {
      name: businessInfo.name || '',
      phone: businessInfo.phone || '',
      address: businessInfo.address || ''
    },
    clients: clients.map((client) => {
      const balanceCents = getInternalBalanceCents(client);

      return {
        name: client.name,
        phone: client.phone,
        street: client.street,
        number: client.number,
        balanceCents,
        transactions: (client.transactions || []).map((txn) => ({
          type: txn.type,
          amountCents: getInternalTransactionAmountCents(txn),
          date: txn.date,
          paymentMethod: txn.paymentMethod || '-'
        }))
      };
    })
  };
}

/**
 * Internal application records may still expose balance as cents for
 * compatibility. The exported backup field is always balanceCents.
 */
function getInternalBalanceCents(client) {
  const value = client?.balanceCents ?? client?.balance;

  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new Error(
      `El saldo de "${client?.name || 'cliente'}" no es un entero valido de centavos.`
    );
  }

  return value;
}

function getInternalTransactionAmountCents(txn) {
  const value = txn?.amountCents ?? txn?.amount;

  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw new Error(
      'Una transaccion contiene un monto que no es un entero valido de centavos.'
    );
  }

  return value;
}

/**
 * Compara los totales monetarios de dos backups V2.
 */
export function compareBackupTotals(backup1, backup2) {
  const calculateTotal = (backup) => {
    if (!backup || !Array.isArray(backup.clients)) {
      throw new Error('Backup invalido para comparar totales.');
    }

    return backup.clients.reduce(
      (sum, client) => sum + (
        client.balanceCents ??
        client.balance ??
        0
      ),
      0
    );
  };

  const total1 = calculateTotal(backup1);
  const total2 = calculateTotal(backup2);
  const differences = [];

  if (total1 !== total2) {
    differences.push(
      `Total de saldo: $${(total1 / 100).toFixed(2)} vs $${(total2 / 100).toFixed(2)}`
    );
  }

  const txnCount1 = backup1.clients.reduce(
    (sum, c) => sum + (c.transactions || []).length,
    0
  );

  const txnCount2 = backup2.clients.reduce(
    (sum, c) => sum + (c.transactions || []).length,
    0
  );

  if (txnCount1 !== txnCount2) {
    differences.push(
      `Cantidad de movimientos: ${txnCount1} vs ${txnCount2}`
    );
  }

  return {
    match: differences.length === 0,
    totals: {
      backup1: total1,
      backup2: total2
    },
    differences
  };
}
