import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

function createDefaultState() {
  return {
    version: 2,
    initialized: false,
    mods: {},
    pending: {},
    restart: {
      requiresOfflineCycle: false,
      offlineSeen: false,
      onlineSince: null
    }
  };
}

function normalizeState(raw) {
  const fallback = createDefaultState();

  if (!raw || typeof raw !== 'object') return fallback;

  return {
    version: 2,
    initialized: Boolean(raw.initialized),
    mods: raw.mods && typeof raw.mods === 'object' ? raw.mods : {},
    pending:
      raw.pending && typeof raw.pending === 'object' ? raw.pending : {},
    restart: {
      requiresOfflineCycle: Boolean(raw.restart?.requiresOfflineCycle),
      offlineSeen: Boolean(raw.restart?.offlineSeen),
      onlineSince:
        raw.restart?.onlineSince !== null &&
        raw.restart?.onlineSince !== undefined &&
        Number.isFinite(Number(raw.restart.onlineSince))
          ? Number(raw.restart.onlineSince)
          : null
    }
  };
}

export class StateStore {
  constructor(dataDir) {
    this.dataDir = dataDir || './data';
    this.filePath = path.join(this.dataDir, 'workshop-monitor-state.json');
  }

  async load() {
    await mkdir(this.dataDir, { recursive: true });

    try {
      const text = await readFile(this.filePath, 'utf8');
      return normalizeState(JSON.parse(text));
    } catch (error) {
      if (error?.code === 'ENOENT') return createDefaultState();

      console.error('[STATE] State file could not be read:', error);

      try {
        await rename(
          this.filePath,
          `${this.filePath}.corrupt-${Date.now()}`
        );
      } catch {
        // Ignore backup errors and continue with a fresh state.
      }

      return createDefaultState();
    }
  }

  async save(state) {
    await mkdir(this.dataDir, { recursive: true });

    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(state, null, 2), 'utf8');
    await rename(temporaryPath, this.filePath);
  }
}
