import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const EVENTS_FILE = ".omoc-events.jsonl";
const MEMORY_FILE = ".omoc-memory.json";
const RESERVATIONS_FILE = ".omoc-reservations.json";

export interface SwarmEvent {
  id: string;
  type: string;
  swarmId: string;
  sessionID?: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

export interface SwarmMemoryEntry {
  id: string;
  swarmId: string;
  key: string;
  value: string;
  precedent?: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface SwarmReservation {
  swarmId: string;
  sessionID: string;
  paths: string[];
  mode: "exclusive" | "shared";
  createdAt: number;
  updatedAt: number;
}

function id(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function ensureDir(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
}

function eventPath(directory: string): string {
  return join(directory, EVENTS_FILE);
}

function memoryPath(directory: string): string {
  return join(directory, MEMORY_FILE);
}

function reservationsPath(directory: string): string {
  return join(directory, RESERVATIONS_FILE);
}

export async function appendSwarmEvent(
  directory: string,
  event: Omit<SwarmEvent, "id" | "timestamp"> & Partial<Pick<SwarmEvent, "id" | "timestamp">>,
): Promise<SwarmEvent> {
  const record: SwarmEvent = {
    id: event.id ?? id("evt"),
    type: event.type,
    swarmId: event.swarmId,
    timestamp: event.timestamp ?? Date.now(),
    ...(event.sessionID ? { sessionID: event.sessionID } : {}),
    ...(event.data ? { data: event.data } : {}),
  };

  await appendFile(eventPath(directory), `${JSON.stringify(record)}\n`, "utf-8");
  return record;
}

export async function loadSwarmEvents(directory: string): Promise<SwarmEvent[]> {
  try {
    const content = await readFile(eventPath(directory), "utf-8");
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as SwarmEvent)
      .filter((event) => typeof event.type === "string" && typeof event.swarmId === "string");
  } catch {
    return [];
  }
}

export function projectSwarmEventCounts(events: SwarmEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) {
    counts[event.type] = (counts[event.type] || 0) + 1;
  }
  return counts;
}

export function recentEvents(events: SwarmEvent[], limit = 10): SwarmEvent[] {
  return [...events].sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
}

export async function loadMemoryEntries(directory: string): Promise<SwarmMemoryEntry[]> {
  try {
    const content = await readFile(memoryPath(directory), "utf-8");
    const parsed = JSON.parse(content) as unknown;
    return Array.isArray(parsed) ? (parsed as SwarmMemoryEntry[]) : [];
  } catch {
    return [];
  }
}

export async function saveMemoryEntries(directory: string, entries: SwarmMemoryEntry[]): Promise<void> {
  await ensureDir(directory);
  await writeFile(memoryPath(directory), JSON.stringify(entries, null, 2), "utf-8");
}

export async function rememberSwarmLearning(
  directory: string,
  input: Omit<SwarmMemoryEntry, "id" | "createdAt" | "updatedAt">,
): Promise<SwarmMemoryEntry> {
  const entries = await loadMemoryEntries(directory);
  const existing = entries.find((entry) => entry.swarmId === input.swarmId && entry.key === input.key);
  const now = Date.now();
  const next: SwarmMemoryEntry = {
    id: existing?.id ?? id("mem"),
    swarmId: input.swarmId,
    key: input.key,
    value: input.value,
    tags: Array.from(new Set(input.tags)),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...(input.precedent ? { precedent: input.precedent } : {}),
  };

  const filtered = entries.filter((entry) => entry.id !== next.id);
  filtered.push(next);
  await saveMemoryEntries(directory, filtered);
  return next;
}

export async function loadReservations(directory: string): Promise<SwarmReservation[]> {
  try {
    const content = await readFile(reservationsPath(directory), "utf-8");
    const parsed = JSON.parse(content) as unknown;
    return Array.isArray(parsed) ? (parsed as SwarmReservation[]) : [];
  } catch {
    return [];
  }
}

export async function saveReservations(directory: string, reservations: SwarmReservation[]): Promise<void> {
  await ensureDir(directory);
  await writeFile(reservationsPath(directory), JSON.stringify(reservations, null, 2), "utf-8");
}

/**
 * Checks if two paths overlap (one is ancestor/descendant of the other)
 * Exported for testing
 */
export function pathsOverlap(path1: string, path2: string): boolean {
  const normalized1 = path1.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalized2 = path2.replace(/\\/g, '/').replace(/\/+$/, '');
  
  // Exact match
  if (normalized1 === normalized2) return true;
  
  // Path1 is ancestor of path2
  if (normalized2.startsWith(normalized1 + '/')) return true;
  
  // Path2 is ancestor of path1
  if (normalized1.startsWith(normalized2 + '/')) return true;
  
  return false;
}

/**
 * Finds conflicts in path reservations with improved detection
 */
function findPathConflict(
  current: SwarmReservation[],
  reservation: Omit<SwarmReservation, "createdAt" | "updatedAt">,
  normalizedPaths: string[],
): SwarmReservation | undefined {
  // Check for exact path matches and ancestor/descendant overlaps
  for (const entry of current) {
    if (entry.swarmId === reservation.swarmId) continue; // Same swarm, no conflict
    
    // Exclusive mode conflicts with any overlapping path
    if (entry.mode === 'exclusive') {
      for (const newPath of normalizedPaths) {
        for (const existingPath of entry.paths) {
          if (pathsOverlap(newPath, existingPath)) {
            return entry;
          }
        }
      }
    }
    
    // Shared mode only conflicts with exclusive reservations on same paths
    if (entry.mode === 'shared' && reservation.mode === 'exclusive') {
      for (const newPath of normalizedPaths) {
        if (entry.paths.some((existingPath) => existingPath === newPath)) {
          return entry;
        }
      }
    }
  }
  
  return undefined;
}

export async function reserveSwarmPaths(
  directory: string,
  reservation: Omit<SwarmReservation, "createdAt" | "updatedAt">,
): Promise<{ ok: boolean; conflict?: SwarmReservation; reservations: SwarmReservation[] }> {
  const current = await loadReservations(directory);
  const normalizedPaths = reservation.paths.map((path) => path.trim()).filter(Boolean);
  const conflict = findPathConflict(current, reservation, normalizedPaths);

  if (conflict) {
    return { ok: false, conflict, reservations: current };
  }

  const now = Date.now();
  const next: SwarmReservation = {
    swarmId: reservation.swarmId,
    sessionID: reservation.sessionID,
    paths: normalizedPaths,
    mode: reservation.mode,
    createdAt: now,
    updatedAt: now,
  };

  const withoutCurrent = current.filter(
    (entry) => !(entry.swarmId === next.swarmId && entry.sessionID === next.sessionID),
  );
  withoutCurrent.push(next);
  await saveReservations(directory, withoutCurrent);
  return { ok: true, reservations: withoutCurrent };
}

export async function releaseSwarmReservations(directory: string, swarmId: string, sessionID?: string): Promise<void> {
  const current = await loadReservations(directory);
  const filtered = current.filter((entry) => {
    if (entry.swarmId !== swarmId) return true;
    if (sessionID && entry.sessionID !== sessionID) return true;
    return false;
  });
  await saveReservations(directory, filtered);
}

export function findSwarmIdFromEvents(events: SwarmEvent[], sessionID: string): string | undefined {
  const match = [...events].reverse().find((event) => event.sessionID === sessionID && event.swarmId);
  return match?.swarmId;
}
