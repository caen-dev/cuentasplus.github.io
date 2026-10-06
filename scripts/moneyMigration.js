'use strict';

import { parseMoneyToCents } from './currency.js';

export const MONEY_MODEL_VERSION = 2;

/**
 * El modelo monetario V2 usa exclusivamente enteros de centavos.
 */
export function isValidCents(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function hasOwn(object, property) {
  return Object.prototype.hasOwnProperty.call(object, property);
}

/**
 * Convierte un importe legacy expresado en pesos a centavos.
 *
 * Ejemplos:
 * 12.5        -> 1250
 * "12.5"      -> 1250
 * "1.234,56"  -> 123456
 */
function legacyMoneyToCents(value, fieldName) {
  if (value === null || value === undefined || value === '') {
    throw new Error(`El campo monetario "${fieldName}" está vacío.`);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`El campo monetario "${fieldName}" no es válido.`);
    }

    const cents = Math.round(value * 100);

    if (!isValidCents(cents)) {
      throw new Error(`El campo monetario "${fieldName}" supera el límite permitido.`);
    }

    return cents;
  }

  const cents = parseMoneyToCents(value);

  if (!isValidCents(cents)) {
    throw new Error(`El campo monetario "${fieldName}" no es válido.`);
  }

  return cents;
}

/**
 * Detecta el modelo monetario de un cliente.
 *
 * Reglas:
 * - moneyModelVersion=2 -> cents.
 * - Sin versión + alguna transacción con amountCents -> cents,
 *   pero el balance debe ser un entero válido.
 * - Sin amountCents -> legacy.
 * - Un modelo parcialmente mezclado se rechaza; no se adivina.
 */
export function detectMoneyModel(client) {
  if (!client || typeof client !== 'object') {
    return 'invalid';
  }

  if (hasOwn(client, 'moneyModelVersion')) {
    if (client.moneyModelVersion === MONEY_MODEL_VERSION) {
      return 'cents';
    }

    return 'unsupported';
  }

  const transactions = Array.isArray(client.transactions)
    ? client.transactions
    : [];

  const hasAmountCents = transactions.some((transaction) =>
    transaction &&
    typeof transaction === 'object' &&
    hasOwn(transaction, 'amountCents')
  );

  const hasLegacyAmount = transactions.some((transaction) =>
    transaction &&
    typeof transaction === 'object' &&
    hasOwn(transaction, 'amount') &&
    !hasOwn(transaction, 'amountCents')
  );

  if (!hasAmountCents && !hasLegacyAmount) {
    return 'legacy';
  }

  if (hasAmountCents && hasLegacyAmount) {
    return 'ambiguous';
  }

  if (hasLegacyAmount) {
    return 'legacy';
  }

  if (!isValidCents(client.balance)) {
    return 'ambiguous';
  }

  const hasInvalidAmountCents = transactions.some((transaction) =>
    !transaction ||
    typeof transaction !== 'object' ||
    !isValidCents(transaction.amountCents)
  );

  if (hasInvalidAmountCents) {
    return 'invalid';
  }

  return 'cents';
}

/**
 * Normaliza un cliente completo al modelo monetario V2.
 *
 * Nunca modifica el objeto original.
 *
 * Legacy:
 *   balance y transaction.amount están expresados en pesos.
 *
 * V2:
 *   balance y transaction.amountCents están expresados en centavos.
 *
 * Al finalizar V2:
 *   balance              -> centavos
 *   amountCents          -> centavos
 *   amount                -> centavos (compatibilidad)
 *   moneyModelVersion    -> 2
 */
export function normalizeClientMoney(client) {
  if (!client) {
    return client;
  }

  const model = detectMoneyModel(client);

  if (model === 'unsupported') {
    throw new Error(
      `Modelo monetario no compatible: ${client.moneyModelVersion}.`
    );
  }

  if (model === 'ambiguous') {
    throw new Error(
      'El registro contiene datos monetarios mezclados y no puede migrarse automáticamente.'
    );
  }

  if (model === 'invalid') {
    throw new Error('El registro monetario no tiene una estructura válida.');
  }

  const normalized = {
    ...client
  };

  const transactions = Array.isArray(client.transactions)
    ? client.transactions
    : [];

  if (model === 'legacy') {
    normalized.balance = legacyMoneyToCents(
      client.balance,
      `saldo de "${client.name || 'cliente'}"`
    );

    normalized.transactions = transactions.map((transaction, index) => {
      const amountCents = legacyMoneyToCents(
        transaction?.amount,
        `transacción ${index}`
      );

      return {
        ...transaction,
        amountCents,
        amount: amountCents,
        moneyModelVersion: MONEY_MODEL_VERSION
      };
    });
  } else {
    if (!isValidCents(client.balance)) {
      throw new Error(
        `El saldo de "${client.name || 'cliente'}" no está expresado como centavos enteros.`
      );
    }

    normalized.balance = client.balance;

    normalized.transactions = transactions.map((transaction, index) => {
      if (!transaction || typeof transaction !== 'object') {
        throw new Error(`La transacción ${index} no es válida.`);
      }

      if (!isValidCents(transaction.amountCents)) {
        throw new Error(
          `La transacción ${index} no contiene amountCents válido.`
        );
      }

      return {
        ...transaction,
        amountCents: transaction.amountCents,
        amount: transaction.amountCents,
        moneyModelVersion: MONEY_MODEL_VERSION
      };
    });
  }

  normalized.moneyModelVersion = MONEY_MODEL_VERSION;

  return normalized;
}
