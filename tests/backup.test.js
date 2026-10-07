import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateBackup,
  migrateBackupV1,
  createBackupObject
} from '../scripts/backup.js';

test('backup V2 válido usa centavos explícitos', () => {
  const backup = {
    format: 'cuentasplus-backup',
    version: 2,
    moneyModelVersion: 2,
    money: {
      currency: 'ARS',
      unit: 'cent',
      decimals: 2
    },
    business: {
      name: 'Mi negocio',
      phone: '123',
      address: 'Calle 1'
    },
    clients: [{
      name: 'Ana',
      balanceCents: 15000,
      transactions: [{
        type: 'purchase',
        amountCents: 2500,
        date: '2026-10-06'
      }]
    }]
  };

  const result = validateBackup(backup);

  assert.equal(result.clients[0].balanceCents, 15000);
  assert.equal(result.clients[0].transactions[0].amountCents, 2500);
});

test('backup V2 sin moneyModelVersion es rechazado', () => {
  const backup = {
    format: 'cuentasplus-backup',
    version: 2,
    money: {
      currency: 'ARS',
      unit: 'cent',
      decimals: 2
    },
    business: {
      name: 'Mi negocio',
      phone: '123',
      address: 'Calle 1'
    },
    clients: []
  };

  assert.throws(
    () => validateBackup(backup),
    /modelo monetario|moneyModelVersion/i
  );
});

test('backup V2 con moneda distinta de ARS es rechazado', () => {
  const backup = {
    format: 'cuentasplus-backup',
    version: 2,
    moneyModelVersion: 2,
    money: {
      currency: 'USD',
      unit: 'cent',
      decimals: 2
    },
    business: {
      name: 'Mi negocio',
      phone: '123',
      address: 'Calle 1'
    },
    clients: []
  };

  assert.throws(
    () => validateBackup(backup),
    /ARS|moneda/i
  );
});

test('backup V2 con balance decimal es rechazado', () => {
  const backup = {
    format: 'cuentasplus-backup',
    version: 2,
    moneyModelVersion: 2,
    money: {
      currency: 'ARS',
      unit: 'cent',
      decimals: 2
    },
    business: {
      name: 'Mi negocio',
      phone: '123',
      address: 'Calle 1'
    },
    clients: [{
      name: 'Ana',
      balanceCents: 15000.5,
      transactions: []
    }]
  };

  assert.throws(
    () => validateBackup(backup),
    /saldo|centavos|entero/i
  );
});

test('backup V2 con amount decimal es rechazado', () => {
  const backup = {
    format: 'cuentasplus-backup',
    version: 2,
    moneyModelVersion: 2,
    money: {
      currency: 'ARS',
      unit: 'cent',
      decimals: 2
    },
    business: {
      name: 'Mi negocio',
      phone: '123',
      address: 'Calle 1'
    },
    clients: [{
      name: 'Ana',
      balanceCents: 15000,
      transactions: [{
        type: 'purchase',
        amountCents: 2500.5,
        date: '2026-10-06'
      }]
    }]
  };

  assert.throws(
    () => validateBackup(backup),
    /monto|centavos|entero/i
  );
});

test('backup V2 no acepta balance legacy', () => {
  const backup = {
    format: 'cuentasplus-backup',
    version: 2,
    moneyModelVersion: 2,
    money: {
      currency: 'ARS',
      unit: 'cent',
      decimals: 2
    },
    business: {
      name: 'Mi negocio',
      phone: '123',
      address: 'Calle 1'
    },
    clients: [{
      name: 'Ana',
      balance: 15000,
      transactions: []
    }]
  };

  assert.throws(
    () => validateBackup(backup),
    /balanceCents|saldo/i
  );
});

test('backup V2 no acepta amount legacy como fuente monetaria', () => {
  const backup = {
    format: 'cuentasplus-backup',
    version: 2,
    moneyModelVersion: 2,
    money: {
      currency: 'ARS',
      unit: 'cent',
      decimals: 2
    },
    business: {
      name: 'Mi negocio',
      phone: '123',
      address: 'Calle 1'
    },
    clients: [{
      name: 'Ana',
      balanceCents: 15000,
      transactions: [{
        type: 'purchase',
        amount: 2500,
        date: '2026-10-06'
      }]
    }]
  };

  assert.throws(
    () => validateBackup(backup),
    /amountCents|monto/i
  );
});

test('createBackupObject genera V2 con contrato monetario explícito', () => {
  const backup = createBackupObject(
    {
      name: 'Mi negocio',
      phone: '123',
      address: 'Calle 1'
    },
    [{
      name: 'Ana',
      phone: '456',
      street: 'Calle',
      number: '10',
      balance: 15000,
      moneyModelVersion: 2,
      transactions: [{
        type: 'purchase',
        amountCents: 2500,
        date: '2026-10-06',
        paymentMethod: 'efectivo'
      }]
    }]
  );

  assert.equal(backup.version, 2);
  assert.equal(backup.moneyModelVersion, 2);
  assert.deepEqual(backup.money, {
    currency: 'ARS',
    unit: 'cent',
    decimals: 2
  });

  assert.equal(backup.clients[0].balanceCents, 15000);
  assert.equal(
    backup.clients[0].transactions[0].amountCents,
    2500
  );

  assert.equal(
    Object.hasOwn(backup.clients[0], 'balance'),
    false
  );

  assert.equal(
    Object.hasOwn(backup.clients[0].transactions[0], 'amount'),
    false
  );
});


test('backup V1 explícito en pesos migra correctamente a centavos', () => {
  const backup = {
    format: 'cuentasplus-backup',
    version: 1,
    business: {
      name: 'Almacén',
      phone: '123',
      address: 'Calle 1'
    },
    clients: [{
      name: 'Ana',
      balance: 150.5,
      transactions: [{
        type: 'Compra',
        amount: 25.75,
        date: '06/10/2026',
        paymentMethod: 'efectivo'
      }]
    }]
  };

  const migrated = migrateBackupV1(backup, 'pesos');

  assert.equal(migrated.version, 2);
  assert.equal(migrated.moneyModelVersion, 2);
  assert.equal(migrated.money.currency, 'ARS');
  assert.equal(migrated.money.unit, 'cent');
  assert.equal(migrated.clients[0].balanceCents, 15050);
  assert.equal(
    migrated.clients[0].transactions[0].amountCents,
    2575
  );
});

test('backup V1 explícito en centavos conserva los valores', () => {
  const backup = {
    format: 'cuentasplus-backup',
    version: 1,
    business: {
      name: 'Almacén',
      phone: '123',
      address: 'Calle 1'
    },
    clients: [{
      name: 'Ana',
      balance: 15050,
      transactions: [{
        type: 'Compra',
        amount: 2575,
        date: '06/10/2026',
        paymentMethod: 'efectivo'
      }]
    }]
  };

  const migrated = migrateBackupV1(backup, 'centavos');

  assert.equal(migrated.version, 2);
  assert.equal(migrated.clients[0].balanceCents, 15050);
  assert.equal(
    migrated.clients[0].transactions[0].amountCents,
    2575
  );
});

test('backup V1 sin unidad explícita es rechazado', () => {
  const backup = {
    format: 'cuentasplus-backup',
    version: 1,
    business: {
      name: 'Almacén',
      phone: '123',
      address: 'Calle 1'
    },
    clients: [{
      name: 'Ana',
      balance: 15050,
      transactions: [{
        type: 'Compra',
        amount: 2575,
        date: '06/10/2026'
      }]
    }]
  };

  assert.throws(
    () => migrateBackupV1(backup),
    /pesos.*centavos|unidad.*pesos|unidad.*centavos/i
  );
});

test('backup V1 en pesos acepta el máximo monetario permitido', () => {
  const backup = {
    format: 'cuentasplus-backup',
    version: 1,
    business: {
      name: 'Almacén',
      phone: '123',
      address: 'Calle 1'
    },
    clients: [{
      name: 'Ana',
      balance: 9999999999.99,
      transactions: [{
        type: 'Compra',
        amount: 9999999999.99,
        date: '06/10/2026',
        paymentMethod: 'efectivo'
      }]
    }]
  };

  const migrated = migrateBackupV1(backup, 'pesos');

  assert.equal(
    migrated.clients[0].balanceCents,
    999999999999
  );

  assert.equal(
    migrated.clients[0].transactions[0].amountCents,
    999999999999
  );
});

test('backup V1 en centavos acepta el máximo monetario permitido', () => {
  const backup = {
    format: 'cuentasplus-backup',
    version: 1,
    business: {
      name: 'Almacén',
      phone: '123',
      address: 'Calle 1'
    },
    clients: [{
      name: 'Ana',
      balance: 999999999999,
      transactions: [{
        type: 'Compra',
        amount: 999999999999,
        date: '06/10/2026',
        paymentMethod: 'efectivo'
      }]
    }]
  };

  const migrated = migrateBackupV1(backup, 'centavos');

  assert.equal(
    migrated.clients[0].balanceCents,
    999999999999
  );

  assert.equal(
    migrated.clients[0].transactions[0].amountCents,
    999999999999
  );
});

test('backup V1 en pesos rechaza valores por encima del máximo monetario', () => {
  const backup = {
    format: 'cuentasplus-backup',
    version: 1,
    business: {
      name: 'Almacén',
      phone: '123',
      address: 'Calle 1'
    },
    clients: [{
      name: 'Ana',
      balance: 10000000000,
      transactions: []
    }]
  };

  assert.throws(
    () => migrateBackupV1(backup, 'pesos'),
    /rango monetario|valor monetario|inv[aá]lido/i
  );
});

test('backup V1 en centavos rechaza valores por encima del máximo monetario', () => {
  const backup = {
    format: 'cuentasplus-backup',
    version: 1,
    business: {
      name: 'Almacén',
      phone: '123',
      address: 'Calle 1'
    },
    clients: [{
      name: 'Ana',
      balance: 1000000000000,
      transactions: []
    }]
  };

  assert.throws(
    () => migrateBackupV1(backup, 'centavos'),
    /rango monetario|valor monetario|inv[aá]lido/i
  );
});
test('backup V1 con unidad inválida es rechazado', () => {
  const backup = {
    format: 'cuentasplus-backup',
    version: 1,
    business: {
      name: 'Almacén',
      phone: '123',
      address: 'Calle 1'
    },
    clients: []
  };

  assert.throws(
    () => migrateBackupV1(backup, 'auto'),
    /pesos|centavos/i
  );
});

test('validateBackup rechaza V1 en lugar de inferir su unidad', () => {
  const backup = {
    format: 'cuentasplus-backup',
    version: 1,
    business: {
      name: 'Almacén',
      phone: '123',
      address: 'Calle 1'
    },
    clients: [{
      name: 'Ana',
      balance: 15050,
      transactions: [{
        type: 'Compra',
        amount: 2575,
        date: '06/10/2026'
      }]
    }]
  };

  assert.throws(
    () => validateBackup(backup),
    /V1|migraci[oó]n.*expl[ií]cita|unidad/i
  );
});

test('migración V1 no permite mezclar balance y balanceCents', () => {
  const backup = {
    format: 'cuentasplus-backup',
    version: 1,
    business: {
      name: 'Almacén',
      phone: '123',
      address: 'Calle 1'
    },
    clients: [{
      name: 'Ana',
      balance: 150,
      balanceCents: 15000,
      transactions: []
    }]
  };

  assert.throws(
    () => migrateBackupV1(backup, 'pesos'),
    /balance.*balanceCents|ambigua/i
  );
});

test('migración V1 no permite mezclar amount y amountCents', () => {
  const backup = {
    format: 'cuentasplus-backup',
    version: 1,
    business: {
      name: 'Almacén',
      phone: '123',
      address: 'Calle 1'
    },
    clients: [{
      name: 'Ana',
      balance: 150,
      transactions: [{
        type: 'Compra',
        amount: 25,
        amountCents: 2500,
        date: '06/10/2026'
      }]
    }]
  };

  assert.throws(
    () => migrateBackupV1(backup, 'pesos'),
    /amount.*amountCents|ambigua/i
  );
});
