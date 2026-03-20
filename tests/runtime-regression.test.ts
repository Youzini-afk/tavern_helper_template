function assertEqual(actual: unknown, expected: unknown, message?: string) {
  if (actual !== expected) {
    throw new Error(message ?? `Assertion failed: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertArrayEqual(actual: unknown[], expected: unknown[], message?: string) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(message ?? `Assertion failed: expected ${expectedJson}, got ${actualJson}`);
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
  (
    globalThis as {
      _?: {
        groupBy: typeof import('lodash/groupBy');
        sum: typeof import('lodash/sum');
        escapeRegExp: typeof import('lodash/escapeRegExp');
      };
    }
  )._ = {
    groupBy: (await import('lodash/groupBy')).default,
    sum: (await import('lodash/sum')).default,
    escapeRegExp: (await import('lodash/escapeRegExp')).default,
  } as any;

  const { buildArchivedSnapshotVersionKeyForTest } =
    await import('../src/evolution-world-assistant/runtime/snapshot-storage.ts');
  const { selectSnapshotFromSourcesForTest } =
    await import('../src/evolution-world-assistant/runtime/floor-binding.ts');
  const { selectActivatedEntriesForTest } =
    await import('../src/evolution-world-assistant/runtime/worldinfo-engine.ts');

  test('buildArchivedSnapshotVersionKey should append incremental suffix on collisions', () => {
    const baseKey = 'sw:1|habc';
    const revisionStamp = 1700000000000;
    const store = makeStore([`${baseKey}@rev:${revisionStamp}`, `${baseKey}@rev:${revisionStamp}_1`]);

    const result = buildArchivedSnapshotVersionKeyForTest(baseKey, store as any, revisionStamp);
    assertEqual(result.archivedKey, `${baseKey}@rev:${revisionStamp}_2`);
    assertEqual(result.collisionCount, 2);
  });

  test('selectSnapshotFromSources should stay strict and reject single-version fallback', () => {
    const versionInfo = {
      swipe_id: 3,
      content_hash: 'h-target',
      version_key: 'sw:3|h-target',
    };
    const snapshot = { controllers: [], dyn_entries: [], swipe_id: 2, content_hash: 'h-older' };
    const result = selectSnapshotFromSourcesForTest(
      [
        {
          source: 'file',
          versions: {
            'sw:2|h-older': snapshot,
          },
          fileName: 'ew__test.json',
        },
      ],
      versionInfo,
      'strict',
    );

    assertEqual(result.resolution, 'missing');
    assertEqual(result.snapshot, null);
    assertEqual(result.source, 'none');
    assertEqual(result.available_version_count, 0);
  });

  test('selectSnapshotFromSources should use single-version fallback only in history mode', () => {
    const versionInfo = {
      swipe_id: 3,
      content_hash: 'h-target',
      version_key: 'sw:3|h-target',
    };
    const snapshot = { controllers: [], dyn_entries: [], swipe_id: 2, content_hash: 'h-older' };
    const result = selectSnapshotFromSourcesForTest(
      [
        {
          source: 'inline',
          versions: {
            'sw:2|h-older': snapshot,
          },
        },
      ],
      versionInfo,
      'history',
    );

    assertEqual(result.resolution, 'single_fallback');
    assertEqual(result.snapshot, snapshot);
    assertEqual(result.source, 'inline');
    assertEqual(result.matched_version_key, 'sw:2|h-older');
    assertEqual(result.available_version_count, 1);
  });

  test('selectActivatedEntries should honor groupOverride entries with order=0', () => {
    const entries = [
      {
        uid: 1,
        name: 'group-zero',
        comment: '',
        content: 'A',
        cleanContent: 'A',
        decorators: [],
        enabled: true,
        worldbook: 'wb',
        constant: false,
        selective: false,
        keys: ['hero'],
        keysSecondary: [],
        selectiveLogic: 0,
        useProbability: false,
        probability: 100,
        caseSensitive: false,
        matchWholeWords: false,
        group: 'g',
        groupOverride: true,
        groupWeight: 100,
        useGroupScoring: false,
        position: 1,
        depth: 0,
        order: 0,
        role: 'system',
      },
      {
        uid: 2,
        name: 'group-later',
        comment: '',
        content: 'B',
        cleanContent: 'B',
        decorators: [],
        enabled: true,
        worldbook: 'wb',
        constant: false,
        selective: false,
        keys: ['hero'],
        keysSecondary: [],
        selectiveLogic: 0,
        useProbability: false,
        probability: 100,
        caseSensitive: false,
        matchWholeWords: false,
        group: 'g',
        groupOverride: true,
        groupWeight: 100,
        useGroupScoring: false,
        position: 1,
        depth: 0,
        order: 5,
        role: 'system',
      },
    ];

    const activated = selectActivatedEntriesForTest(entries as any, 'hero trigger');
    assertEqual(activated.length, 1);
    assertEqual(activated[0].name, 'group-zero');
  });

  test('selectActivatedEntries should not let scoring members override prioritized group members', () => {
    const entries = [
      {
        uid: 1,
        name: 'priority-winner',
        comment: '',
        content: 'A',
        cleanContent: 'A',
        decorators: [],
        enabled: true,
        worldbook: 'wb',
        constant: false,
        selective: false,
        keys: ['hero'],
        keysSecondary: [],
        selectiveLogic: 0,
        useProbability: false,
        probability: 100,
        caseSensitive: false,
        matchWholeWords: false,
        group: 'g',
        groupOverride: true,
        groupWeight: 100,
        useGroupScoring: false,
        position: 1,
        depth: 0,
        order: 1,
        role: 'system',
      },
      {
        uid: 2,
        name: 'scoring-member',
        comment: '',
        content: 'B',
        cleanContent: 'B',
        decorators: [],
        enabled: true,
        worldbook: 'wb',
        constant: false,
        selective: true,
        keys: ['hero'],
        keysSecondary: ['trigger'],
        selectiveLogic: 0,
        useProbability: false,
        probability: 100,
        caseSensitive: false,
        matchWholeWords: false,
        group: 'g',
        groupOverride: false,
        groupWeight: 100,
        useGroupScoring: true,
        position: 1,
        depth: 0,
        order: 99,
        role: 'system',
      },
    ];

    const activated = selectActivatedEntriesForTest(entries as any, 'hero trigger');
    assertEqual(activated.length, 1);
    assertEqual(activated[0].name, 'priority-winner');
  });

  test('selectActivatedEntries should keep ungrouped entries together with matched grouped winner', () => {
    const entries = [
      {
        uid: 1,
        name: 'ungrouped',
        comment: '',
        content: 'A',
        cleanContent: 'A',
        decorators: [],
        enabled: true,
        worldbook: 'wb',
        constant: false,
        selective: false,
        keys: ['hero'],
        keysSecondary: [],
        selectiveLogic: 0,
        useProbability: false,
        probability: 100,
        caseSensitive: false,
        matchWholeWords: false,
        group: '',
        groupOverride: false,
        groupWeight: 100,
        useGroupScoring: false,
        position: 1,
        depth: 0,
        order: 2,
        role: 'system',
      },
      {
        uid: 2,
        name: 'grouped-winner',
        comment: '',
        content: 'B',
        cleanContent: 'B',
        decorators: [],
        enabled: true,
        worldbook: 'wb',
        constant: false,
        selective: false,
        keys: ['hero'],
        keysSecondary: [],
        selectiveLogic: 0,
        useProbability: false,
        probability: 100,
        caseSensitive: false,
        matchWholeWords: false,
        group: 'g',
        groupOverride: true,
        groupWeight: 100,
        useGroupScoring: false,
        position: 1,
        depth: 0,
        order: 1,
        role: 'system',
      },
    ];

    const activated = selectActivatedEntriesForTest(entries as any, 'hero trigger');
    assertArrayEqual(
      activated.map(entry => entry.name),
      ['grouped-winner', 'ungrouped'],
    );
  });
}

void run();
