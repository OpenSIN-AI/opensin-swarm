/**
 * Registry-driven subagent resolution for OMOC Swarm
 * 
 * This module provides durable member identity tracking that survives
 * session restarts and avoids brittle title-based inference.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Current schema version for registry entries
 * Version 1: Initial schema
 * Version 2: Added migration support and stricter validation
 */
export const CURRENT_SCHEMA_VERSION = 2;
export const CURRENT_REGISTRY_VERSION = 2;

export interface SwarmMemberRegistryEntry {
  schemaVersion: number;
  memberName: string;
  agentId: string;
  capabilities?: string[];
  createdAt: number;
  lastSeenAt?: number;
}

export interface SwarmMemberRegistryEntryV1 extends Omit<SwarmMemberRegistryEntry, 'schemaVersion'> {
  schemaVersion: 1;
}

export interface SwarmMemberRegistryEntryV2 extends SwarmMemberRegistryEntry {
  schemaVersion: 2;
  migratedFrom?: number;
}

export interface SwarmRegistry {
  version: number;
  swarmId: string;
  createdAt: number;
  members: Record<string, SwarmMemberRegistryEntry>;
}

export interface SwarmRegistryV1 extends Omit<SwarmRegistry, 'version' | 'members'> {
  version: 1;
  members: Record<string, SwarmMemberRegistryEntryV1>;
}

export interface SwarmRegistryV2 extends SwarmRegistry {
  version: 2;
  members: Record<string, SwarmMemberRegistryEntryV2>;
}

export type SwarmRegistryAnyVersion = SwarmRegistryV1 | SwarmRegistryV2;

export interface SwarmMemberDescriptor {
  name: string;
  agent: string;
  capabilities?: string[];
}

const REGISTRY_DIRNAME = ".omoc-registry";

/**
 * Known agent aliases - maps legacy role names to canonical agent IDs
 */
export const AGENT_ALIASES: Record<string, string> = {
  // Legacy role names
  planner: 'plan',
  researcher: 'explore',
  coder: 'build',
  reviewer: 'general',
  
  // Canonical names (identity mapping)
  plan: 'plan',
  explore: 'explore',
  build: 'build',
  general: 'general',
  
  // Additional known agents
  oracle: 'oracle',
  metis: 'metis',
  momus: 'momus',
  librarian: 'librarian',
};

/**
 * List of all valid agent IDs
 */
export const VALID_AGENT_IDS = [
  'plan',
  'build',
  'explore',
  'general',
  'oracle',
  'metis',
  'momus',
  'librarian',
] as const;

export type ValidAgentId = typeof VALID_AGENT_IDS[number];

/**
 * Validates if an agent ID is known/valid
 */
export function isValidAgentId(agentId: string): agentId is ValidAgentId {
  return VALID_AGENT_IDS.includes(agentId as ValidAgentId);
}

/**
 * Resolves an agent ID from an alias or canonical name.
 * Returns null if the agent ID is unknown (not in the known set).
 * 
 * @param agentId - The agent ID or alias to resolve
 * @returns The canonical agent ID, or null if unknown
 */
export function resolveAgentId(agentId: string): string | null {
  const normalized = agentId.toLowerCase().trim();
  
  // Check if it's a known alias
  if (AGENT_ALIASES[normalized]) {
    return AGENT_ALIASES[normalized];
  }
  
  // Check if it's a valid agent ID directly
  if (isValidAgentId(normalized)) {
    return normalized;
  }
  
  // Unknown agent
  return null;
}

/**
 * Creates a new registry entry for a swarm member
 */
export function createRegistryEntry(
  memberName: string,
  agentId: string,
  capabilities: string[] = []
): SwarmMemberRegistryEntry | null {
  const resolvedAgentId = resolveAgentId(agentId);
  
  if (!resolvedAgentId) {
    return null;
  }
  
  return {
    schemaVersion: 1,
    memberName: memberName.toLowerCase().trim(),
    agentId: resolvedAgentId,
    capabilities,
    createdAt: Date.now(),
  };
}

export function getRegistryPath(directory: string, swarmId: string): string {
  return join(directory, REGISTRY_DIRNAME, `${swarmId}.json`);
}

/**
 * Migrates a v1 registry entry to v2
 */
export function migrateEntryToV2(entry: SwarmMemberRegistryEntryV1): SwarmMemberRegistryEntryV2 {
  return {
    ...entry,
    schemaVersion: 2,
    migratedFrom: 1,
  };
}

/**
 * Migrates a v1 registry to v2
 */
export function migrateRegistryToV2(registry: SwarmRegistryV1): SwarmRegistryV2 {
  const migratedMembers: Record<string, SwarmMemberRegistryEntryV2> = {};
  for (const [key, entry] of Object.entries(registry.members)) {
    migratedMembers[key] = migrateEntryToV2(entry);
  }

  return {
    ...registry,
    version: 2,
    members: migratedMembers,
  };
}

/**
 * Detects the schema version of a registry entry
 */
export function detectEntryVersion(entry: unknown): number | null {
  if (!entry || typeof entry !== 'object') return null;
  const e = entry as Partial<SwarmMemberRegistryEntry>;
  if (typeof e.schemaVersion !== 'number') return null;
  return e.schemaVersion;
}

/**
 * Detects the version of a registry
 */
export function detectRegistryVersion(registry: unknown): number | null {
  if (!registry || typeof registry !== 'object') return null;
  const r = registry as Partial<SwarmRegistry>;
  if (typeof r.version !== 'number') return null;
  return r.version;
}

export async function saveSwarmRegistry(
  directory: string,
  swarmId: string,
  members: Record<string, SwarmMemberDescriptor>,
): Promise<SwarmRegistry> {
  const registry: SwarmRegistry = {
    version: 1,
    swarmId,
    createdAt: Date.now(),
    members: Object.fromEntries(
      Object.values(members).map((member) => {
        const entry = createRegistryEntry(member.name, member.agent, member.capabilities ?? []);
        if (!entry) {
          throw new Error(`Unable to create registry entry for ${member.name}`);
        }
        return [entry.memberName, entry];
      }),
    ),
  };

  await mkdir(join(directory, REGISTRY_DIRNAME), { recursive: true });
  await writeFile(getRegistryPath(directory, swarmId), JSON.stringify(registry, null, 2), "utf-8");
  return registry;
}

export async function loadSwarmRegistry(directory: string, swarmId: string): Promise<SwarmRegistry | null> {
  try {
    const raw = await readFile(getRegistryPath(directory, swarmId), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    
    // Detect version and migrate if needed
    const version = detectRegistryVersion(parsed);
    if (version === null) return null;
    
    // Migrate v1 to v2
    if (version === 1) {
      const migrated = migrateRegistryToV2(parsed as SwarmRegistryV1);
      // Save migrated version
      await writeFile(getRegistryPath(directory, swarmId), JSON.stringify(migrated, null, 2), "utf-8");
      return migrated;
    }
    
    // Already v2 or unknown version
    return validateRegistry(parsed) ? parsed as SwarmRegistry : null;
  } catch {
    return null;
  }
}

/**
 * Validates a complete registry structure
 */
export function validateRegistry(registry: unknown): registry is SwarmRegistry {
  if (!registry || typeof registry !== 'object') return false;

  const reg = registry as Partial<SwarmRegistry>;

  // Support versions 1 and 2
  if (reg.version !== 1 && reg.version !== 2) return false;
  if (!reg.swarmId || typeof reg.swarmId !== 'string') return false;
  if (!reg.members || typeof reg.members !== 'object') return false;

  // Validate each member entry
  for (const [key, entry] of Object.entries(reg.members)) {
    if (!validateRegistryEntry(entry)) return false;
    if (entry.memberName !== key) return false; // Key must match memberName
  }

  return true;
}

/**
 * Validates a single registry entry
 */
export function validateRegistryEntry(entry: unknown): entry is SwarmMemberRegistryEntry {
  if (!entry || typeof entry !== 'object') return false;

  const e = entry as Partial<SwarmMemberRegistryEntry>;

  // Support schema versions 1 and 2
  if (e.schemaVersion !== 1 && e.schemaVersion !== 2) return false;
  if (!e.memberName || typeof e.memberName !== 'string') return false;
  if (!e.agentId || typeof e.agentId !== 'string') return false;
  if (!resolveAgentId(e.agentId)) return false;
  if (e.createdAt && typeof e.createdAt !== 'number') return false;
  if (e.lastSeenAt && typeof e.lastSeenAt !== 'number') return false;
  
  // V2 specific: check migratedFrom if schemaVersion is 2
  if (e.schemaVersion === 2) {
    const e2 = entry as Partial<SwarmMemberRegistryEntryV2>;
    if (e2.migratedFrom && typeof e2.migratedFrom !== 'number') return false;
  }

  return true;
}

/**
 * Generates a diagnostic message for unknown agent IDs
 */
export function getUnknownAgentDiagnostic(
  unknownAgentId: string,
  validAgents: string[]
): string {
  const validList = validAgents.join(', ');
  const suggestions = getAgentSuggestions(unknownAgentId);
  
  let msg = `Unknown agent ID: "${unknownAgentId}"\n`;
  msg += `Valid agent IDs: ${validList}\n`;
  
  if (suggestions.length > 0) {
    msg += `\nDid you mean: ${suggestions.join(', ')}?`;
  }
  
  return msg;
}

/**
 * Suggests similar agent IDs for a given input
 */
export function getAgentSuggestions(input: string): string[] {
  const normalized = input.toLowerCase().trim();
  const suggestions: string[] = [];
  
  // Check for partial matches
  for (const agentId of VALID_AGENT_IDS) {
    if (agentId.includes(normalized) || normalized.includes(agentId)) {
      suggestions.push(agentId);
    }
  }
  
  return suggestions.slice(0, 3);
}
