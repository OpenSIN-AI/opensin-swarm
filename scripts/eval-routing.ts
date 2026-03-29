import { resolveAgentId, VALID_AGENT_IDS, createRegistryEntry } from "../plugins/registry.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const benchmarkData = readFileSync(join(__dirname, "../benchmarks/routing-selector-benchmark.json"), "utf-8");
const benchmark = JSON.parse(benchmarkData);

type SelectorCandidate = {
  name: string;
  changedFiles: number;
  testExitCode: number;
  diffSize: number;
  description?: string;
};

type RoutingTestCase = {
  input: string;
  expected: string | null;
  rationale?: string;
};

type SelectorTestCase = {
  scenario: string;
  description?: string;
  prompt: string;
  cases: Array<{
    name: string;
    changedFiles: number;
    testExitCode: number;
    diffSize: number;
    description?: string;
  }>;
  expected: string;
};

/**
 * Scoring function for selector candidates
 * Priority: test status > diff size > file count
 */
function scoreCandidate(candidate: SelectorCandidate): number {
  const testBonus = candidate.testExitCode === 0 ? 1000 : -1000;
  const sizePenalty = candidate.diffSize / 100;
  const filePenalty = candidate.changedFiles * 10;
  return testBonus - sizePenalty - filePenalty;
}

/**
 * Run routing benchmarks
 */
function runRoutingBenchmarks(): { passed: number; total: number; failures: string[] } {
  const failures: string[] = [];
  let passed = 0;
  let total = 0;

  // Test all categories
  for (const category of benchmark.routing.testCases) {
    for (const testCase of category.cases as RoutingTestCase[]) {
      total++;
      const resolved = resolveAgentId(testCase.input);
      const ok = resolved === testCase.expected;
      
      if (ok) {
        passed++;
        console.log(`✓ routing [${category.category}] ${testCase.input} -> ${resolved ?? "null"}`);
      } else {
        failures.push(`routing [${category.category}] ${testCase.input}: expected ${testCase.expected ?? "null"}, got ${resolved ?? "null"}`);
        console.log(`✗ routing [${category.category}] ${testCase.input} -> ${resolved ?? "null"} (expected: ${testCase.expected ?? "null"})`);
      }
    }
  }

  // Test edge cases
  for (const testCase of benchmark.edgeCases.routing as RoutingTestCase[]) {
    total++;
    const resolved = resolveAgentId(testCase.input);
    const ok = resolved === testCase.expected;
    
    if (ok) {
      passed++;
      console.log(`✓ routing [edge] "${testCase.input}" -> ${resolved ?? "null"}`);
    } else {
      failures.push(`routing [edge] "${testCase.input}": expected ${testCase.expected ?? "null"}, got ${resolved ?? "null"}`);
      console.log(`✗ routing [edge] "${testCase.input}" -> ${resolved ?? "null"} (expected: ${testCase.expected ?? "null"})`);
    }
  }

  return { passed, total, failures };
}

/**
 * Run selector benchmarks
 */
function runSelectorBenchmarks(): { passed: number; total: number; failures: string[] } {
  const failures: string[] = [];
  let passed = 0;
  let total = 0;

  for (const testCase of benchmark.selector.testCases as SelectorTestCase[]) {
    total++;
    const candidates = testCase.cases.map(c => ({
      name: c.name,
      changedFiles: c.changedFiles,
      testExitCode: c.testExitCode,
      diffSize: c.diffSize,
    }));
    
    const winner = [...candidates].sort((a, b) => scoreCandidate(b) - scoreCandidate(a))[0]?.name ?? null;
    const ok = winner === testCase.expected;
    
    if (ok) {
      passed++;
      console.log(`✓ selector [${testCase.scenario}] -> ${winner}`);
    } else {
      failures.push(`selector [${testCase.scenario}]: expected ${testCase.expected}, got ${winner}`);
      console.log(`✗ selector [${testCase.scenario}] -> ${winner} (expected: ${testCase.expected})`);
    }
  }

  // Test edge cases
  if (benchmark.edgeCases.selector?.testCases) {
    for (const testCase of benchmark.edgeCases.selector.testCases as any[]) {
      total++;
      const candidates = testCase.cases.map((c: any) => ({
        name: c.name,
        changedFiles: c.changedFiles,
        testExitCode: c.testExitCode,
        diffSize: c.diffSize,
      }));
      
      const winner = [...candidates].sort((a, b) => scoreCandidate(b) - scoreCandidate(a))[0]?.name ?? null;
      const ok = winner === testCase.expected;
      
      if (ok) {
        passed++;
        console.log(`✓ selector [edge: ${testCase.scenario}] -> ${winner}`);
      } else {
        failures.push(`selector [edge: ${testCase.scenario}]: expected ${testCase.expected}, got ${winner}`);
        console.log(`✗ selector [edge: ${testCase.scenario}] -> ${winner} (expected: ${testCase.expected})`);
      }
    }
  }

  return { passed, total, failures };
}

// Run benchmarks
console.log("Running OMOC Swarm Benchmark Suite");
console.log("=".repeat(50));
console.log(`Benchmark corpus: ${benchmark.version}`);
console.log(`Description: ${benchmark.description}`);
console.log("=".repeat(50));
console.log("");

// Routing benchmarks
console.log("Routing Benchmarks:");
console.log("-".repeat(50));
const routingResult = runRoutingBenchmarks();
console.log("");

// Selector benchmarks
console.log("Selector Benchmarks:");
console.log("-".repeat(50));
const selectorResult = runSelectorBenchmarks();
console.log("");

// Summary
const registryCoverage = VALID_AGENT_IDS.length;
const registryEntry = createRegistryEntry("planner", "plan");

const summary = {
  routingPassed: routingResult.passed,
  routingTotal: routingResult.total,
  selectorPassed: selectorResult.passed,
  selectorTotal: selectorResult.total,
  registryCoverage,
  registryEntryOk: Boolean(registryEntry),
};

console.log("=".repeat(50));
console.log("Summary:");
console.log(JSON.stringify(summary, null, 2));
console.log("=".repeat(50));

// Exit with error if any failures
const hasFailures = 
  routingResult.failures.length > 0 || 
  selectorResult.failures.length > 0 ||
  routingResult.passed !== routingResult.total ||
  selectorResult.passed !== selectorResult.total ||
  !registryEntry;

if (hasFailures) {
  console.log("");
  console.log("Failures:");
  if (routingResult.failures.length > 0) {
    console.log("  Routing:");
    routingResult.failures.forEach(f => console.log(`    - ${f}`));
  }
  if (selectorResult.failures.length > 0) {
    console.log("  Selector:");
    selectorResult.failures.forEach(f => console.log(`    - ${f}`));
  }
  process.exit(1);
}
