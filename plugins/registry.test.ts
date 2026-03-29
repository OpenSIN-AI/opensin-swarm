/**
 * Tests for registry-driven subagent resolution
 */

import {
  isValidAgentId,
  resolveAgentId,
  createRegistryEntry,
  validateRegistry,
  validateRegistryEntry,
  getUnknownAgentDiagnostic,
  getAgentSuggestions,
} from './registry.js';

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

// Test valid agent IDs
test('isValidAgentId should return true for valid agents', () => {
  assert(isValidAgentId('plan'), 'plan should be valid');
  assert(isValidAgentId('build'), 'build should be valid');
  assert(isValidAgentId('explore'), 'explore should be valid');
  assert(isValidAgentId('general'), 'general should be valid');
  assert(isValidAgentId('metis'), 'metis should be valid');
  assert(isValidAgentId('momus'), 'momus should be valid');
  assert(isValidAgentId('oracle'), 'oracle should be valid');
  assert(isValidAgentId('librarian'), 'librarian should be valid');
});

test('isValidAgentId should return false for invalid agents', () => {
  assert(!isValidAgentId('invalid'), 'invalid should not be valid');
  assert(!isValidAgentId(''), 'empty string should not be valid');
  assert(!isValidAgentId('unknown'), 'unknown should not be valid');
});

// Test agent resolution
test('resolveAgentId should resolve legacy aliases', () => {
  assertEqual(resolveAgentId('planner'), 'plan', 'planner should resolve to plan');
  assertEqual(resolveAgentId('researcher'), 'explore', 'researcher should resolve to explore');
  assertEqual(resolveAgentId('coder'), 'build', 'coder should resolve to build');
  assertEqual(resolveAgentId('reviewer'), 'general', 'reviewer should resolve to general');
});

test('resolveAgentId should handle canonical names', () => {
  assertEqual(resolveAgentId('plan'), 'plan', 'plan should resolve to plan');
  assertEqual(resolveAgentId('build'), 'build', 'build should resolve to build');
  assertEqual(resolveAgentId('explore'), 'explore', 'explore should resolve to explore');
  assertEqual(resolveAgentId('general'), 'general', 'general should resolve to general');
});

test('resolveAgentId should handle additional agents', () => {
  assertEqual(resolveAgentId('metis'), 'metis', 'metis should resolve to metis');
  assertEqual(resolveAgentId('momus'), 'momus', 'momus should resolve to momus');
  assertEqual(resolveAgentId('oracle'), 'oracle', 'oracle should resolve to oracle');
  assertEqual(resolveAgentId('librarian'), 'librarian', 'librarian should resolve to librarian');
});

test('resolveAgentId should return null for unknown agents', () => {
  assertEqual(resolveAgentId('unknown'), null, 'unknown should return null');
  assertEqual(resolveAgentId(''), null, 'empty string should return null');
  assertEqual(resolveAgentId('invalid_agent'), null, 'invalid_agent should return null');
});

test('resolveAgentId should be case-insensitive', () => {
  assertEqual(resolveAgentId('PLANNER'), 'plan', 'PLANNER should resolve to plan');
  assertEqual(resolveAgentId('Planner'), 'plan', 'Planner should resolve to plan');
  assertEqual(resolveAgentId('METIS'), 'metis', 'METIS should resolve to metis');
});

// Test registry entry creation
test('createRegistryEntry should create valid entries', () => {
  const entry = createRegistryEntry('planner', 'plan');
  assert(entry !== null, 'should create entry');
  assertEqual(entry?.memberName, 'planner', 'memberName should match');
  assertEqual(entry?.agentId, 'plan', 'agentId should match');
  assert(entry?.schemaVersion === 1, 'schemaVersion should be 1');
  assert(typeof entry?.createdAt === 'number', 'createdAt should be a number');
});

test('createRegistryEntry should resolve aliases', () => {
  const entry = createRegistryEntry('planner', 'planner');
  assert(entry !== null, 'should create entry');
  assertEqual(entry?.agentId, 'plan', 'should resolve planner to plan');
});

test('createRegistryEntry should return null for invalid agents', () => {
  const entry = createRegistryEntry('test', 'invalid_agent');
  assertEqual(entry, null, 'should return null for invalid agent');
});

test('createRegistryEntry should normalize member names', () => {
  const entry1 = createRegistryEntry('  Planner  ', 'plan');
  assertEqual(entry1?.memberName, 'planner', 'should trim and lowercase');
  
  const entry2 = createRegistryEntry('PLANNER', 'plan');
  assertEqual(entry2?.memberName, 'planner', 'should lowercase');
});

// Test registry validation
test('validateRegistryEntry should validate correct entries', () => {
  const entry = {
    schemaVersion: 1,
    memberName: 'planner',
    agentId: 'plan',
    createdAt: Date.now(),
  };
  assert(validateRegistryEntry(entry), 'should validate correct entry');
});

test('validateRegistryEntry should reject invalid entries', () => {
  assert(!validateRegistryEntry(null), 'should reject null');
  assert(!validateRegistryEntry({}), 'should reject empty object');
  assert(!validateRegistryEntry({ schemaVersion: 2 }), 'should reject wrong schema version');
  assert(!validateRegistryEntry({ schemaVersion: 1 }), 'should reject missing fields');
});

test('validateRegistry should validate complete registries', () => {
  const registry = {
    version: 1,
    swarmId: 'swarm_123',
    createdAt: Date.now(),
    members: {
      planner: {
        schemaVersion: 1,
        memberName: 'planner',
        agentId: 'plan',
        createdAt: Date.now(),
      },
      coder: {
        schemaVersion: 1,
        memberName: 'coder',
        agentId: 'build',
        createdAt: Date.now(),
      },
    },
  };
  assert(validateRegistry(registry), 'should validate complete registry');
});

test('validateRegistry should reject invalid registries', () => {
  assert(!validateRegistry(null), 'should reject null');
  assert(!validateRegistry({}), 'should reject empty object');
  assert(!validateRegistry({ version: 2 }), 'should reject wrong version');
  assert(!validateRegistry({ version: 1, swarmId: 'test' }), 'should reject missing members');
});

// Test diagnostic messages
test('getUnknownAgentDiagnostic should generate helpful messages', () => {
  const message = getUnknownAgentDiagnostic('invalid', ['plan', 'build', 'explore']);
  assert(message.includes('invalid'), 'should include the unknown agent');
  assert(message.includes('plan'), 'should list valid agents');
});

test('getAgentSuggestions should find similar agents', () => {
  const suggestions = getAgentSuggestions('plan');
  assert(suggestions.some((s: string) => s.includes('plan')), 'should find plan-related agents');
});

test('getAgentSuggestions should limit results', () => {
  const suggestions = getAgentSuggestions('');
  assert(suggestions.length <= 3, 'should return at most 3 suggestions');
});

console.log('\nAll tests passed! ✓');
