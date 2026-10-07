import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';

import {
generateUUID,
ensureClientUUIDs,
ensureTransactionUUIDs,
getOrCreateBusinessId,
detectLegacyClient,
clientNeedsNormalization,
} from '../scripts/migration.js';

import {
initDB,
loadAllClients,
saveClient
} from '../scripts/db.js';

const MIGRATION_TS = '2026-09-28T10:00:00.000Z';

const UUID_RE =
/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeStorage() {
let state = {};

return {
getItem(key) {
return Object.prototype.hasOwnProperty.call(state, key)
? state[key]
: null;
},

setItem(key, value) {
  state[key] = String(value);
},

removeItem(key) {
  delete state[key];
},

clear() {
  state = {};
}

};
}

class FakeDatabase {
version = 2;

stores = new Map([
  ['clientsStore', new Map()],
  ['metadata', new Map()],
  ['syncQueue', new Map()]
]);

storeKeyPaths = new Map([
  ['clientsStore', 'name'],
  ['metadata', 'key'],
  ['syncQueue', 'id']
]);

failNextWrite = false;

objectStoreNames = {
  contains: (name) => this.stores.has(name)
};

transaction(storeName, mode) {
  if (!this.stores.has(storeName)) {
    throw new Error(`Unknown object store: ${storeName}`);
  }

  const records = this.stores.get(storeName);
  const stagedRecords = new Map(records);

  const store = {
    put: (record) => {
      const key =
        storeName === 'clientsStore'
          ? record.name
          : storeName === 'metadata'
            ? record.key
            : record.id;

      stagedRecords.set(
        key,
        structuredClone(record)
      );
    },

    delete: (key) => {
      stagedRecords.delete(key);
    },

    clear: () => {
      stagedRecords.clear();
    },

    getAll: () => {
      const request = {};

      queueMicrotask(() => {
        request.result = [
          ...stagedRecords.values()
        ].map((record) => structuredClone(record));

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

      this.stores.set(
        storeName,
        stagedRecords
      );

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

globalThis.window = {
localStorage: makeStorage()
};

globalThis.localStorage =
globalThis.window.localStorage;

globalThis.indexedDB = {
  open: (_name, version) => {
    const request = {
      result: fakeDatabase
    };

    queueMicrotask(() => {
      const oldVersion = fakeDatabase.version;

      if (version > oldVersion) {
        fakeDatabase.version = version;

        request.onupgradeneeded?.({
          target: request,
          oldVersion
        });
      }

      request.onsuccess?.({
        target: request
      });
    });

    return request;
  }
};

before(async () => {
await initDB();
});

beforeEach(() => {
globalThis.localStorage.clear();
for (const store of fakeDatabase.stores.values()) {
  store.clear();
}
fakeDatabase.failNextWrite = false;
});

test('generateUUID creates a valid v4 UUID', () => {
const id = generateUUID();

assert.match(id, UUID_RE);
});

test('client UUID is preserved if already present', () => {
const existingId =
'11111111-2222-4333-8333-444444444444';

const client = {
id: existingId,
name: 'Ana'
};

const normalized =
ensureClientUUIDs(client, MIGRATION_TS);

assert.equal(normalized.id, existingId);
});

test('different clients receive different UUIDs', () => {
const ana =
ensureClientUUIDs({ name: 'Ana' }, MIGRATION_TS);

const bruno =
ensureClientUUIDs({ name: 'Bruno' }, MIGRATION_TS);

assert.notEqual(ana.id, bruno.id);
});

test('businessId is unique and shared across clients and transactions', () => {
const ana =
ensureClientUUIDs({ name: 'Ana' }, MIGRATION_TS);

const bruno =
ensureClientUUIDs({ name: 'Bruno' }, MIGRATION_TS);

const tx =
ensureTransactionUUIDs(
{ date: '2026-09-28' },
ana.id,
MIGRATION_TS
);

assert.ok(ana.businessId);
assert.equal(
ana.businessId,
bruno.businessId
);

assert.equal(
ana.businessId,
tx.businessId
);

assert.equal(
getOrCreateBusinessId(),
ana.businessId
);
});

test('createdAt is generated only when missing', () => {
const generated =
ensureClientUUIDs(
{ name: 'Ana' },
MIGRATION_TS
);

const preserved =
ensureClientUUIDs(
{
name: 'Ana',
createdAt: '2020-01-01T00:00:00.000Z'
},
MIGRATION_TS
);

assert.equal(
generated.createdAt,
MIGRATION_TS
);

assert.equal(
preserved.createdAt,
'2020-01-01T00:00:00.000Z'
);
});

test('createdAt existing is never overwritten', () => {
const original = {
name: 'Ana',
createdAt: '2024-03-02T00:00:00.000Z'
};

const normalized =
ensureClientUUIDs(
original,
MIGRATION_TS
);

assert.equal(
normalized.createdAt,
original.createdAt
);
});

test('updatedAt is set for legacy records and preserved when already present', () => {
const legacy =
ensureClientUUIDs(
{ name: 'Ana' },
MIGRATION_TS
);

const existing =
ensureClientUUIDs(
{
name: 'Ana',
updatedAt: '2025-01-02T00:00:00.000Z'
},
MIGRATION_TS
);

assert.equal(
legacy.updatedAt,
MIGRATION_TS
);

assert.equal(
existing.updatedAt,
'2025-01-02T00:00:00.000Z'
);
});

test('transaction UUID, clientId and date migration are correct', () => {
const tx =
ensureTransactionUUIDs(
{
date: '2026-09-28'
},
'client-123',
MIGRATION_TS
);

assert.match(tx.id, UUID_RE);
assert.equal(tx.clientId, 'client-123');
assert.equal(tx.occurredAt, '2026-09-28');
});

test('existing occurredAt is never overwritten', () => {
const tx =
ensureTransactionUUIDs(
{
date: '2026-09-29',
occurredAt: '2026-09-28'
},
'client-123',
MIGRATION_TS
);

assert.equal(
tx.occurredAt,
'2026-09-28'
);
});

test('legacy records without new fields remain valid and are detected as legacy', () => {
const legacyClient = {
name: 'Ana',
balance: 1500,
transactions: [
{
type: 'purchase',
amount: 1500,
date: '2026-09-28'
}
]
};

const normalized =
ensureClientUUIDs(
legacyClient,
MIGRATION_TS
);

// The original object is legacy because it has no
// migration identity/metadata fields.
assert.equal(
detectLegacyClient(legacyClient),
true
);

// The normalized object is no longer legacy.
assert.equal(
detectLegacyClient(normalized),
false
);

assert.equal(
clientNeedsNormalization(legacyClient),
true
);

assert.equal(
normalized.transactions[0].clientId,
normalized.id
);

assert.equal(
normalized.transactions[0].businessId,
normalized.businessId
);

assert.equal(
normalized.transactions[0].occurredAt,
'2026-09-28'
);
});

test('normalize -> save -> load -> normalize preserves all identity fields', async () => {
const legacyClient = {
name: 'Ana',
balance: 2500,
transactions: [
{
type: 'purchase',
amount: 2500,
date: '2026-09-28'
}
]
};

const normalizedBeforeSave =
ensureClientUUIDs(
legacyClient,
MIGRATION_TS
);

await saveClient(normalizedBeforeSave);

const loaded =
await loadAllClients();

const normalizedAfterLoad =
ensureClientUUIDs(
loaded[0],
MIGRATION_TS
);

assert.equal(
normalizedAfterLoad.id,
normalizedBeforeSave.id
);

assert.equal(
normalizedAfterLoad.businessId,
normalizedBeforeSave.businessId
);

assert.equal(
normalizedAfterLoad.transactions[0].clientId,
normalizedBeforeSave.id
);

assert.equal(
normalizedAfterLoad.transactions[0].businessId,
normalizedBeforeSave.businessId
);

assert.equal(
normalizedAfterLoad.transactions[0].occurredAt,
normalizedBeforeSave.transactions[0].occurredAt
);

assert.equal(
normalizedAfterLoad.createdAt,
normalizedBeforeSave.createdAt
);
});
