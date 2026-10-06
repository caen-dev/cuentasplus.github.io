import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';

class FakeDatabase {
records = new Map();
failNextWrite = false;

objectStoreNames = {
contains: () => true
};

transaction(_storeName, mode) {
const stagedRecords = new Map(this.records);

const store = {
  put: (client) => {
    stagedRecords.set(
      client.name,
      structuredClone(client)
    );
  },

  delete: (name) => {
    stagedRecords.delete(name);
  },

  clear: () => {
    stagedRecords.clear();
  },

  getAll: () => {
    const request = {};

    queueMicrotask(() => {
      request.result = [
        ...stagedRecords.values()
      ].map((client) => structuredClone(client));

      request.onsuccess?.();
    });

    return request;
  }
};

const transaction = {
  error: null,
  objectStore: () => store
};

if (mode === 'readwrite') {
  const shouldFail = this.failNextWrite;
  this.failNextWrite = false;

  queueMicrotask(() => {
    if (shouldFail) {
      transaction.error =
        new Error('Simulated IndexedDB write failure');

      transaction.onerror?.();
      transaction.onabort?.();
      return;
    }

    this.records = stagedRecords;
    transaction.oncomplete?.();
  });
} else {
  queueMicrotask(() => {
    transaction.oncomplete?.();
  });
}

return transaction;

}
}

const fakeDatabase = new FakeDatabase();

globalThis.window = {};

globalThis.$ = () => {};

globalThis.indexedDB = {
open: () => {
const request = {};

queueMicrotask(() => {
  request.result = fakeDatabase;
  request.onsuccess?.({ target: request });
});

return request;

}
};

const {
initDB,
loadAllClients,
replaceAllClients,
saveClient
} = await import('../scripts/db.js');

const {
validateBackup
} = await import('../scripts/backup.js');

const {
buildClientSummaryRows,
buildTransactionRows,
serializeCSV
} = await import('../scripts/report.js');

const {
filterClients,
getLatestTransaction,
searchClients,
sortClients
} = await import('../scripts/ui.js');

const {
filterTransactions,
transactionTypeLabel
} = await import('../scripts/history.js');

const {
formatMoneyLive,
normalizeSearchText,
parseLocalDate,
parseMoneyToNumber
} = await import('../scripts/utils.js');

const {
startApp
} = await import('../scripts/app.js');

before(async () => {
await initDB();
});

beforeEach(async () => {
fakeDatabase.records.clear();
fakeDatabase.failNextWrite = false;
});

test('application entrypoint and its module graph load', () => {
assert.equal(
typeof startApp,
'function'
);
});

test('loadAllClients migrates legacy money to V2 and persists it', async () => {
  fakeDatabase.records.set(
    'Legacy',
    {
      name: 'Legacy',
      balance: 1500.50,
      transactions: [
        {
          type: 'purchase',
          amount: 100.25,
          date: '2026-10-05'
        }
      ]
    }
  );

  const loaded = await loadAllClients();

  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].balance, 150050);
  assert.equal(loaded[0].moneyModelVersion, 2);
  assert.equal(loaded[0].transactions[0].amountCents, 10025);
  assert.equal(loaded[0].transactions[0].amount, 10025);

  const stored = fakeDatabase.records.get('Legacy');

  assert.equal(stored.balance, 150050);
  assert.equal(stored.moneyModelVersion, 2);
  assert.equal(stored.transactions[0].amountCents, 10025);
});

test('loadAllClients rejects ambiguous money without changing stored data', async () => {
  const ambiguous = {
    name: 'Ambiguous',
    balance: 1500,
    transactions: []
  };

  fakeDatabase.records.set(
    ambiguous.name,
    structuredClone(ambiguous)
  );

  await assert.rejects(
    loadAllClients(),
    /mezclados/
  );

  assert.deepEqual(
    fakeDatabase.records.get(ambiguous.name),
    ambiguous
  );
});

test('saveClient normalizes legacy money before storing', async () => {
  await saveClient({
    name: 'Legacy Save',
    balance: '250,50',
    transactions: [
      {
        type: 'purchase',
        amount: '10,25',
        date: '2026-10-05'
      }
    ]
  });

  const stored =
    fakeDatabase.records.get('Legacy Save');

  assert.equal(stored.balance, 25050);
  assert.equal(stored.moneyModelVersion, 2);
  assert.equal(stored.transactions[0].amountCents, 1025);
  assert.equal(stored.transactions[0].amount, 1025);
});
test('client renames replace the old key atomically', async () => {
const original = {
name: 'Almacén Norte',
balance: 4500,
transactions: [],
moneyModelVersion: 2
};

await saveClient(original);

const renamed = {
...original,
name: 'Almacén Central'
};

await saveClient(
renamed,
original.name
);

const loaded =
await loadAllClients();

assert.equal(
loaded.length,
1
);

assert.equal(
loaded[0].name,
'Almacén Central'
);

assert.equal(
loaded[0].balance,
4500
);
});

test('failed client writes leave stored records unchanged', async () => {
const original = {
name: 'Lucía',
balance: 2000,
transactions: [],
moneyModelVersion: 2
};

await saveClient(original);

const renamed = {
...original,
name: 'Lucía Gómez'
};

fakeDatabase.failNextWrite = true;

await assert.rejects(
saveClient(
renamed,
original.name
),
/Simulated IndexedDB write failure/
);

const loaded =
await loadAllClients();

assert.equal(
loaded.length,
1
);

assert.equal(
loaded[0].name,
'Lucía'
);

assert.equal(
loaded[0].balance,
2000
);
});

test('failed backup replacement does not clear existing records', async () => {
const original = {
name: 'Ana',
balance: 1000,
transactions: [],
moneyModelVersion: 2
};

await saveClient(original);

fakeDatabase.failNextWrite = true;

await assert.rejects(
replaceAllClients([
{
name: 'Nuevo',
balance: 0,
transactions: [],
moneyModelVersion: 2
}
]),
/Simulated IndexedDB write failure/
);

const loaded =
await loadAllClients();

assert.equal(
loaded.length,
1
);

assert.equal(
loaded[0].name,
'Ana'
);

assert.equal(
loaded[0].balance,
1000
);
});

test('backup validation normalizes transaction labels', () => {
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
name: 'Almacén',
phone: '',
address: ''
},
clients: [
{
name: ' Ana ',
balanceCents: 1250,
transactions: [
{
type: 'Compra',
amountCents: 1250,
date: '28/09/2026'
}
]
}
]
};

const result =
validateBackup(backup);

assert.equal(
result.business.name,
'Almacén'
);

assert.equal(
result.clients.length,
1
);

assert.equal(
result.clients[0].name,
'Ana'
);

// 12.5 pesos = 1250 centavos.
assert.equal(
result.clients[0].balanceCents,
1250
);

assert.equal(
result.clients[0].transactions[0].type,
'purchase'
);

assert.equal(
result.clients[0].transactions[0].amountCents,
1250
);

assert.equal(
result.clients[0].transactions[0].amount,
1250
);
});

test('backup validation rejects duplicate clients and malformed transactions', () => {
const base = {
format: 'cuentasplus-backup',
version: 2,
moneyModelVersion: 2,
money: {
currency: 'ARS',
unit: 'cent',
decimals: 2
},
business: {
name: '',
phone: '',
address: ''
},
clients: []
};

const client = {
name: 'Ana',
balanceCents: 0,
transactions: []
};

assert.throws(
() =>
validateBackup({
...base,
clients: [
client,
{ ...client }
]
}),
/clientes duplicados/
);

assert.throws(
() =>
validateBackup({
...base,
clients: [
{
...client,
transactions: [
{
type: 'hack',
amountCents: 1,
date: 'hoy'
}
]
}
]
}),
/tipo invalido/
);
});

test('reports include clients without debt and every detailed transaction', () => {
const clients = [
{
name: 'Ana',
phone: '123',
balance: 0,
transactions: [
{
type: 'purchase',
amountCents: 5000,
date: '28/09/2026',
paymentMethod: 'efectivo'
},
{
type: 'payment',
amountCents: 5000,
date: '27/09/2026',
paymentMethod: 'transferencia'
}
]
},

{
  name: 'Cliente nuevo',
  phone: '-',
  balance: 0,
  transactions: []
}

];

assert.equal(
buildClientSummaryRows(clients).length,
3
);

assert.equal(
buildClientSummaryRows(clients)[1][2],
'28/09/2026'
);

assert.deepEqual(
buildTransactionRows(clients).slice(1),
[
[
'28/09/2026',
'Ana',
'Compra',
'$50,00',
'efectivo'
],
[
'27/09/2026',
'Ana',
'Pago',
'$50,00',
'transferencia'
]
]
);

assert.equal(
buildTransactionRows(clients).length,
3
);
});

test('directory filter includes paid clients and searches contact details', () => {
const directory = [
{
name: 'José',
phone: '555-100',
street: 'Mitre',
number: '20',
balance: 0
},

{
  name: 'Bruno',
  phone: '555-200',
  street: 'Belgrano',
  number: '45',
  balance: 500
}

];

assert.deepEqual(
filterClients(directory).map(
(client) => client.name
),
['José', 'Bruno']
);

assert.deepEqual(
filterClients(
directory,
'',
'debt'
).map((client) => client.name),
['Bruno']
);

assert.deepEqual(
filterClients(
directory,
'jose'
).map((client) => client.name),
['José']
);

assert.deepEqual(
filterClients(
directory,
'mitre'
).map((client) => client.name),
['José']
);

assert.deepEqual(
filterClients(
directory,
'555-200'
).map((client) => client.name),
['Bruno']
);
});

test('search normalization is accent- and case-insensitive', () => {
assert.equal(
normalizeSearchText('ÁRBOL'),
'arbol'
);
});

test('transaction client search prioritizes names and matches contact fields', () => {
const directory = [
{
name: 'María José',
phone: '555-020',
street: 'Belgrano',
number: '8'
},

{
  name: 'José',
  phone: '555-100',
  street: 'Mitre',
  number: '20'
},

{
  name: 'San José',
  phone: '555-200',
  street: 'Roca',
  number: '12'
}

];

assert.deepEqual(
searchClients(
directory,
'jose'
).map((client) => client.name),
[
'José',
'María José',
'San José'
]
);

assert.deepEqual(
searchClients(
directory,
'555-100'
).map((client) => client.name),
['José']
);

assert.deepEqual(
searchClients(
directory,
'mitré'
).map((client) => client.name),
['José']
);
});

test('directory sorting uses transaction dates and supports debt and name order', () => {
const directory = [
{
name: 'Bruno',
balance: 500,
transactions: [
{
date: '20/09/2026'
},
{
date: '02/09/2026'
}
]
},

{
  name: 'Ana',
  balance: 1500,
  transactions: [
    {
      date: '10/09/2026'
    }
  ]
},

{
  name: 'Carlos',
  balance: 0,
  transactions: []
}

];

assert.deepEqual(
sortClients(directory).map(
(client) => client.name
),
[
'Bruno',
'Ana',
'Carlos'
]
);

assert.deepEqual(
sortClients(
directory,
'balance'
).map((client) => client.name),
[
'Ana',
'Bruno',
'Carlos'
]
);

assert.deepEqual(
sortClients(
directory,
'name'
).map((client) => client.name),
[
'Ana',
'Bruno',
'Carlos'
]
);
});

test('directory latest transaction uses the newest valid date regardless of array order', () => {
const transactions = [
{
date: '02/09/2026',
amountCents: 2000
},

{
  date: '20/09/2026',
  amountCents: 5000
},

{
  date: '31/02/2026',
  amountCents: 10000
}

];

assert.equal(
getLatestTransaction(
transactions
).amountCents,
5000
);

assert.equal(
getLatestTransaction([]),
undefined
);
});

test('transaction history filters by month and purchase/payment type, newest first', () => {
const transactions = [
{
type: 'Compra',
amountCents: 2000,
date: '02/08/2026',
paymentMethod: 'efectivo'
},

{
  type: 'payment',
  amountCents: 1000,
  date: '15/09/2026',
  paymentMethod: 'transferencia'
},

{
  type: 'purchase',
  amountCents: 500,
  date: '03/09/2026',
  paymentMethod: 'tarjeta'
}

];

assert.deepEqual(
filterTransactions(
transactions,
{
month: '2026-09'
}
).map(
(transaction) => transaction.date
),
[
'15/09/2026',
'03/09/2026'
]
);

assert.deepEqual(
filterTransactions(
transactions,
{
month: '2026-09',
type: 'purchase'
}
).map(
(transaction) => transaction.date
),
['03/09/2026']
);

assert.equal(
transactionTypeLabel('Pago'),
'Pago'
);
});

test('CSV serialization quotes delimiters and neutralizes spreadsheet formulas', () => {
  const csv = serializeCSV([
    ['Cliente', 'Nota'],
    [
      '=SUM(1,2)',
      'Nombre "especial"; sucursal'
    ]
  ]);

  assert.match(
    csv,
    /^\uFEFF"Cliente";"Nota"/
  );

  assert.match(
    csv,
    /"'=SUM\(1,2\)";"Nombre ""especial""; sucursal"/
  );
});

test('amount formatting and parsing preserve Argentine decimal input as cents', () => {
assert.equal(
formatMoneyLive('1234567,89'),
'1.234.567,89'
);

// 1.234.567,89 pesos = 123.456.789 centavos.
assert.equal(
parseMoneyToNumber('1.234.567,89'),
123456789
);

assert.equal(
formatMoneyLive('12.'),
'12'
);

assert.equal(
formatMoneyLive('12.34'),
'1.234'
);

assert.equal(
parseMoneyToNumber('12.34'),
1234
);

assert.equal(
parseMoneyToNumber('1.234'),
123400
);

assert.equal(
formatMoneyLive('12,345'),
'12,345'
);

assert.ok(
Number.isNaN(
parseMoneyToNumber('')
)
);

assert.ok(
Number.isNaN(
parseMoneyToNumber('12abc')
)
);

assert.ok(
Number.isNaN(
parseMoneyToNumber('12,345')
)
);
});

test('money guardrail accepts the maximum supported ARS value', () => {
  assert.equal(
  parseMoneyToNumber('9.999.999.999,99'),
  999999999999
  );

  assert.equal(
  parseMoneyToNumber('9999999999.99'),
  999999999999
  );
});

test('money guardrail rejects values above the maximum', () => {
  assert.ok(
  Number.isNaN(
  parseMoneyToNumber('10.000.000.000,00')
  )
  );

  assert.ok(
  Number.isNaN(
  parseMoneyToNumber('10000000000')
  )
  );
});

test('money parser continues rejecting negative values', () => {
  assert.ok(
  Number.isNaN(
  parseMoneyToNumber('-1')
  )
  );
});
test('date parsing rejects invalid day/month values', () => {
assert.equal(
parseLocalDate(
'28/09/2026'
).getDate(),
28
);

assert.equal(
parseLocalDate(
'32/09/2026'
),
null
);

assert.equal(
parseLocalDate(
'31/04/2026'
),
null
);

assert.equal(
parseLocalDate(
'29/02/2024'
).getDate(),
29
);

assert.equal(
parseLocalDate(
'29/02/2025'
),
null
);
});
