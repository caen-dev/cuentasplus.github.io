import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MONEY_MODEL_VERSION,
  detectMoneyModel,
  normalizeClientMoney
} from '../scripts/moneyMigration.js';

test('money model version is 2', () => {
  assert.equal(MONEY_MODEL_VERSION, 2);
});

test('legacy client without amountCents is detected as legacy', () => {
  assert.equal(
    detectMoneyModel({
      name: 'Ana',
      balance: 12.5,
      transactions: [
        {
          type: 'purchase',
          amount: 12.5,
          date: '05/10/2026'
        }
      ]
    }),
    'legacy'
  );
});

test('client with integer amountCents is detected as cents', () => {
  assert.equal(
    detectMoneyModel({
      name: 'Ana',
      balance: 1250,
      transactions: [
        {
          type: 'purchase',
          amountCents: 1250,
          date: '05/10/2026'
        }
      ]
    }),
    'cents'
  );
});

test('money version 2 is detected explicitly', () => {
  assert.equal(
    detectMoneyModel({
      name: 'Ana',
      balance: 1250,
      moneyModelVersion: 2,
      transactions: []
    }),
    'cents'
  );
});

test('mixed monetary representation with non-integer balance is ambiguous', () => {
  assert.equal(
    detectMoneyModel({
      name: 'Ana',
      balance: 12.5,
      transactions: [
        {
          type: 'purchase',
          amountCents: 1250
        }
      ]
    }),
    'ambiguous'
  );
});

test('unsupported money model version is rejected', () => {
  assert.equal(
    detectMoneyModel({
      name: 'Ana',
      balance: 1250,
      moneyModelVersion: 99,
      transactions: []
    }),
    'unsupported'
  );
});

test('legacy monetary values are converted to integer cents', () => {
  const result = normalizeClientMoney({
    name: 'Ana',
    balance: 12.5,
    transactions: [
      {
        type: 'purchase',
        amount: 12.5,
        date: '05/10/2026'
      }
    ]
  });

  assert.equal(result.balance, 1250);
  assert.equal(result.transactions[0].amountCents, 1250);
  assert.equal(result.transactions[0].amount, 1250);
  assert.equal(result.moneyModelVersion, 2);
  assert.equal(result.transactions[0].moneyModelVersion, 2);
});

test('legacy Argentine formatted values are converted correctly', () => {
  const result = normalizeClientMoney({
    name: 'Ana',
    balance: '1.234,56',
    transactions: [
      {
        type: 'purchase',
        amount: '1.234,56'
      }
    ]
  });

  assert.equal(result.balance, 123456);
  assert.equal(result.transactions[0].amountCents, 123456);
});

test('V2 monetary values remain unchanged', () => {
  const original = {
    name: 'Ana',
    balance: 1250,
    moneyModelVersion: 2,
    transactions: [
      {
        type: 'purchase',
        amountCents: 1250,
        amount: 1250,
        moneyModelVersion: 2
      }
    ]
  };

  const result = normalizeClientMoney(original);

  assert.equal(result.balance, 1250);
  assert.equal(result.transactions[0].amountCents, 1250);
  assert.equal(result.transactions[0].amount, 1250);
  assert.equal(result.moneyModelVersion, 2);
});

test('normalizing twice is idempotent', () => {
  const first = normalizeClientMoney({
    name: 'Ana',
    balance: 12.5,
    transactions: [
      {
        type: 'purchase',
        amount: 12.5
      }
    ]
  });

  const second = normalizeClientMoney(first);

  assert.deepEqual(second, first);
});

test('partially migrated transaction without amountCents is rejected', () => {
  assert.throws(
    () =>
      normalizeClientMoney({
        name: 'Ana',
        balance: 1250,
        transactions: [
          {
            type: 'purchase',
            amount: 12.5
          },
          {
            type: 'purchase',
            amountCents: 500
          }
        ]
      }),
    /mezclados|amountCents/
  );
});

test('invalid negative legacy monetary value is rejected', () => {
  assert.throws(
    () =>
      normalizeClientMoney({
        name: 'Ana',
        balance: -12.5,
        transactions: []
      }),
    /no es válido/
  );
});
