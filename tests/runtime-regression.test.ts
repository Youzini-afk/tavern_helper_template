function assertEqual(actual: unknown, expected: unknown, message?: string) {
  if (actual !== expected) {
    throw new Error(message ?? `Assertion failed: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
  } catch (error) {
    console.error(`[FAIL] ${name}`);
    throw error;
  }
}

type SnapshotVersionStore = {
  version: 'ew-snapshot/v2';
  updated_at: number;
  versions: Record<
    string,
    { controllers: unknown[]; dyn_entries: unknown[]; swipe_id?: number; content_hash?: string }
  >;
  owner?: {
    char_name: string;
    chat_id: string;
    chat_fingerprint: string;
  };
};

function makeStore(keys: string[]): SnapshotVersionStore {
  const versions = Object.fromEntries(
    keys.map(key => [key, { controllers: [], dyn_entries: [], swipe_id: 0, content_hash: key }]),
  );
  return {
    version: 'ew-snapshot/v2',
    updated_at: Date.now(),
    versions,
    owner: {
      char_name: 'test-char',
      chat_id: 'test-chat',
      chat_fingerprint: 'test-fingerprint',
    },
  };
}

async function run() {
  const { z } = await import('zod');
  (globalThis as { z?: typeof z }).z = z;

  const { buildArchivedSnapshotVersionKeyForTest } =
    await import('../src/evolution-world-assistant/runtime/snapshot-storage.ts');

  test('buildArchivedSnapshotVersionKey should append incremental suffix on collisions', () => {
    const baseKey = 'sw:1|habc';
    const revisionStamp = 1700000000000;
    const store = makeStore([`${baseKey}@rev:${revisionStamp}`, `${baseKey}@rev:${revisionStamp}_1`]);

    const result = buildArchivedSnapshotVersionKeyForTest(baseKey, store as any, revisionStamp);
    assertEqual(result.archivedKey, `${baseKey}@rev:${revisionStamp}_2`);
    assertEqual(result.collisionCount, 2);
  });
}

void run();
