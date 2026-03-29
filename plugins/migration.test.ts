/**
 * Regression tests for migration and reservation conflict detection
 */

import {
  CURRENT_SCHEMA_VERSION,
  CURRENT_REGISTRY_VERSION,
  detectEntryVersion,
  detectRegistryVersion,
  migrateEntryToV2,
  migrateRegistryToV2,
  validateRegistry,
  SwarmMemberRegistryEntryV1,
  SwarmRegistryV1,
} from './registry.js';
import { pathsOverlap } from './state.js';

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(`  Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(actual: any, expected: any, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// Migration tests
test('CURRENT_SCHEMA_VERSION should be 2', () => {
  assertEqual(CURRENT_SCHEMA_VERSION, 2, 'Current schema version should be 2');
});

test('CURRENT_REGISTRY_VERSION should be 2', () => {
  assertEqual(CURRENT_REGISTRY_VERSION, 2, 'Current registry version should be 2');
});

test('detectEntryVersion should detect v1 entries', () => {
  const v1Entry = { schemaVersion: 1, memberName: 'test', agentId: 'plan', createdAt: Date.now() };
  assertEqual(detectEntryVersion(v1Entry), 1, 'Should detect v1');
});

test('detectEntryVersion should detect v2 entries', () => {
  const v2Entry = { schemaVersion: 2, memberName: 'test', agentId: 'plan', migratedFrom: 1, createdAt: Date.now() };
  assertEqual(detectEntryVersion(v2Entry), 2, 'Should detect v2');
});

test('detectEntryVersion should return null for invalid entries', () => {
  assertEqual(detectEntryVersion(null), null, 'Should return null for null');
  assertEqual(detectEntryVersion({}), null, 'Should return null for empty object');
  assertEqual(detectEntryVersion({ schemaVersion: '1' }), null, 'Should return null for string version');
});

test('detectRegistryVersion should detect v1 registries', () => {
  const v1Registry = { version: 1, swarmId: 'test', createdAt: Date.now(), members: {} };
  assertEqual(detectRegistryVersion(v1Registry), 1, 'Should detect v1');
});

test('detectRegistryVersion should detect v2 registries', () => {
  const v2Registry = { version: 2, swarmId: 'test', createdAt: Date.now(), members: {} };
  assertEqual(detectRegistryVersion(v2Registry), 2, 'Should detect v2');
});

test('migrateEntryToV2 should preserve all fields', () => {
  const v1Entry: SwarmMemberRegistryEntryV1 = {
    schemaVersion: 1,
    memberName: 'planner',
    agentId: 'plan',
    capabilities: ['planning', 'coordination'],
    createdAt: 1234567890,
    lastSeenAt: 1234567899,
  };
  
  const v2Entry = migrateEntryToV2(v1Entry);
  
  assertEqual(v2Entry.schemaVersion, 2, 'Should update schema version');
  assertEqual(v2Entry.migratedFrom, 1, 'Should track migration source');
  assertEqual(v2Entry.memberName, 'planner', 'Should preserve memberName');
  assertEqual(v2Entry.agentId, 'plan', 'Should preserve agentId');
  assertEqual(v2Entry.capabilities, ['planning', 'coordination'], 'Should preserve capabilities');
  assertEqual(v2Entry.createdAt, 1234567890, 'Should preserve createdAt');
  assertEqual(v2Entry.lastSeenAt, 1234567899, 'Should preserve lastSeenAt');
});

test('migrateRegistryToV2 should migrate all members', () => {
  const v1Registry: SwarmRegistryV1 = {
    version: 1,
    swarmId: 'swarm_123',
    createdAt: 1234567890,
    members: {
      planner: {
        schemaVersion: 1,
        memberName: 'planner',
        agentId: 'plan',
        createdAt: 1234567890,
      },
      coder: {
        schemaVersion: 1,
        memberName: 'coder',
        agentId: 'build',
        createdAt: 1234567891,
      },
    },
  };
  
  const v2Registry = migrateRegistryToV2(v1Registry);
  
  assertEqual(v2Registry.version, 2, 'Should update registry version');
  assertEqual(Object.keys(v2Registry.members).length, 2, 'Should preserve all members');
  
  for (const [key, entry] of Object.entries(v2Registry.members)) {
    assertEqual(entry.schemaVersion, 2, `Member ${key} should have v2 schema`);
    assertEqual(entry.migratedFrom, 1, `Member ${key} should track migration`);
  }
});

test('validateRegistry should accept v2 registries', () => {
  const v2Registry = {
    version: 2,
    swarmId: 'swarm_123',
    createdAt: Date.now(),
    members: {
      planner: {
        schemaVersion: 2,
        memberName: 'planner',
        agentId: 'plan',
        createdAt: Date.now(),
        migratedFrom: 1,
      },
    },
  };
  assert(validateRegistry(v2Registry), 'Should validate v2 registry');
});

// Path overlap tests
test('pathsOverlap should detect exact matches', () => {
  assert(pathsOverlap('src/index.ts', 'src/index.ts'), 'Exact match should overlap');
  assert(pathsOverlap('src/', 'src/'), 'Directory match should overlap');
});

test('pathsOverlap should detect ancestor relationships', () => {
  assert(pathsOverlap('src', 'src/index.ts'), 'Parent should overlap with child');
  assert(pathsOverlap('src/utils', 'src/utils/helpers.ts'), 'Nested parent should overlap');
  assert(pathsOverlap('src/', 'src/index.ts'), 'Parent with slash should overlap');
});

test('pathsOverlap should detect descendant relationships', () => {
  assert(pathsOverlap('src/index.ts', 'src'), 'Child should overlap with parent');
  assert(pathsOverlap('src/utils/helpers.ts', 'src/utils'), 'Nested child should overlap');
});

test('pathsOverlap should handle different path separators', () => {
  assert(pathsOverlap('src\\index.ts', 'src/index.ts'), 'Windows and Unix paths should match');
  assert(pathsOverlap('src\\utils', 'src/utils/helpers.ts'), 'Mixed separators should work');
});

test('pathsOverlap should handle trailing slashes', () => {
  assert(pathsOverlap('src/', 'src'), 'Trailing slash should not matter');
  assert(pathsOverlap('src//', 'src/'), 'Multiple trailing slashes should not matter');
});

test('pathsOverlap should not match unrelated paths', () => {
  assert(!pathsOverlap('src/index.ts', 'src2/index.ts'), 'Different directories should not overlap');
  assert(!pathsOverlap('src/index.ts', 'lib/index.ts'), 'Different roots should not overlap');
  assert(!pathsOverlap('src.ts', 'src/index.ts'), 'Similar names should not overlap');
});

test('pathsOverlap should handle edge cases', () => {
  assert(pathsOverlap('', ''), 'Empty paths should match');
  assert(pathsOverlap('/', '/'), 'Root paths should match');
  assert(!pathsOverlap('src', 'src2'), 'Prefix without separator should not match');
  assert(!pathsOverlap('a', 'ab'), 'Partial prefix should not match');
});

console.log('\nAll migration and conflict detection tests passed! ✓');
