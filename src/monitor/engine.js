import {
  getCollectionModIds,
  getWorkshopDetails
} from '../services/steam.js';
import { checkServer } from '../services/server.js';
import {
  createModEmbed,
  createNotificationContent
} from '../services/embed.js';
import { StateStore } from '../services/state.js';

let store = null;
let state = null;
let previousServerOnline = null;

const runtimeStatus = {
  trackedCount: 0,
  source: 'not configured',
  serverOnline: null,
  lastCheckAt: null
};

function pendingCounts() {
  const counts = { updated: 0, installed: 0, uninstalled: 0 };

  for (const event of Object.values(state?.pending || {})) {
    if (Object.hasOwn(counts, event.type)) counts[event.type] += 1;
  }

  return counts;
}

export function getMonitorStatus() {
  const counts = pendingCounts();
  const restart = state?.restart || {};

  return {
    pendingCount: Object.keys(state?.pending || {}).length,
    pendingUpdated: counts.updated,
    pendingInstalled: counts.installed,
    pendingUninstalled: counts.uninstalled,
    requiresOfflineCycleForPending: Boolean(restart.requiresOfflineCycle),
    offlineSeenAfterPending: Boolean(restart.offlineSeen),
    onlineSinceAfterPendingRestart: restart.onlineSince || null,
    trackedCount: runtimeStatus.trackedCount,
    source: runtimeStatus.source,
    serverOnline: runtimeStatus.serverOnline,
    lastCheckAt: runtimeStatus.lastCheckAt,
    initialized: Boolean(state?.initialized)
  };
}

async function ensureState(dataDir) {
  if (!store) {
    store = new StateStore(dataDir);
    state = await store.load();
  }
}

function toModRecord(mod) {
  return {
    id: String(mod.id),
    title: mod.title,
    updated: Number(mod.updated || 0),
    preview: mod.preview || null,
    url: mod.url
  };
}

async function loadCurrentMods(config) {
  let ids;

  if (config.collectionId) {
    runtimeStatus.source = `Steam collection ${config.collectionId}`;
    ids = await getCollectionModIds(config.collectionId);
  } else {
    runtimeStatus.source = 'WORKSHOP_MOD_IDS';
    ids = config.modIds;
  }

  const normalizedIds = [...new Set(ids.map(String))].filter(Boolean);
  const details = await getWorkshopDetails(normalizedIds);
  const detailsById = new Map(details.map((mod) => [String(mod.id), mod]));
  const currentMods = {};

  for (const id of normalizedIds) {
    const exactDetails = detailsById.get(id);
    const previousDetails = state?.mods?.[id];

    // A temporary Steam details failure must not look like an uninstallation.
    // Previously saved exact names and images are reused whenever possible.
    currentMods[id] = toModRecord(
      exactDetails ||
        previousDetails || {
          id,
          title: `Workshop Item ${id}`,
          updated: 0,
          preview: null,
          url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`
        }
    );
  }

  runtimeStatus.trackedCount = normalizedIds.length;
  return currentMods;
}

function eventEquals(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function setPending(id, event) {
  const existing = state.pending[id];
  if (eventEquals(existing, event)) return false;
  state.pending[id] = event;
  return true;
}

function deletePending(id) {
  if (!state.pending[id]) return false;
  delete state.pending[id];
  return true;
}

function detectModChanges(currentMods, now) {
  const previousMods = state.mods || {};
  let changed = false;

  // Newly installed mods: present now, absent in the previous collection state.
  for (const [id, mod] of Object.entries(currentMods)) {
    if (previousMods[id]) continue;

    const pending = state.pending[id];

    // Removed and re-added before the notification was sent: net change is zero.
    if (pending?.type === 'uninstalled') {
      changed = deletePending(id) || changed;
      console.log(`[MOD RESTORED] ${mod.title} (${id}) is back in the collection.`);
      continue;
    }

    changed =
      setPending(id, {
        type: 'installed',
        mod,
        detectedAt: now
      }) || changed;

    console.log(`[MOD INSTALLED] ${mod.title} (${id}) was added to the collection.`);
  }

  // Uninstalled mods: saved before, no longer present in the collection.
  for (const [id, previousMod] of Object.entries(previousMods)) {
    if (currentMods[id]) continue;

    const pending = state.pending[id];

    // Added and removed again before the server restart: no effective change.
    if (pending?.type === 'installed') {
      changed = deletePending(id) || changed;
      console.log(`[MOD ADD CANCELLED] ${previousMod.title} (${id}) was removed again.`);
      continue;
    }

    changed =
      setPending(id, {
        type: 'uninstalled',
        // Keep the previous exact name and preview image after removal.
        mod: previousMod,
        detectedAt: now
      }) || changed;

    console.log(
      `[MOD UNINSTALLED] ${previousMod.title} (${id}) was removed from the collection.`
    );
  }

  // Existing mods with a newer Workshop timestamp are normal updates.
  for (const [id, mod] of Object.entries(currentMods)) {
    const previousMod = previousMods[id];
    if (!previousMod) continue;

    const pending = state.pending[id];

    // Always refresh pending metadata so the exact current title/image is used.
    if (pending && pending.type !== 'uninstalled') {
      const refreshed = { ...pending, mod };
      changed = setPending(id, refreshed) || changed;
    }

    if (Number(mod.updated) <= Number(previousMod.updated || 0)) continue;

    if (pending?.type === 'installed') {
      console.log(
        `[MOD UPDATED WHILE NEW] ${mod.title} (${id}) changed before installation announcement.`
      );
      continue;
    }

    if (pending?.type === 'uninstalled') continue;

    changed =
      setPending(id, {
        type: 'updated',
        mod,
        detectedAt: now
      }) || changed;

    console.log(`[MOD UPDATED] ${mod.title} (${id}) has a new Workshop update.`);
  }

  state.mods = currentMods;
  return changed;
}

function resetRestartState() {
  state.restart.requiresOfflineCycle = false;
  state.restart.offlineSeen = false;
  state.restart.onlineSince = null;
}

async function announcePending(config, client) {
  if (!config.channelId) {
    console.warn('[WARN] Pending changes exist, but ANNOUNCE_CHANNEL_ID is missing.');
    return false;
  }

  const channel = await client.channels.fetch(config.channelId);

  if (!channel || !channel.isTextBased()) {
    console.warn('[WARN] Announcement channel was not found or is not text based.');
    return false;
  }

  for (const [id, event] of Object.entries(state.pending)) {
    const message = {
      content: createNotificationContent(event.type, config.roleId),
      embeds: [createModEmbed(event.mod, event.type)]
    };

    if (config.roleId) {
      message.allowedMentions = { roles: [config.roleId] };
    }

    await channel.send(message);
    delete state.pending[id];
    await store.save(state);

    console.log(
      `[ANNOUNCED] ${event.type}: ${event.mod.title} (${event.mod.id}).`
    );
  }

  resetRestartState();
  await store.save(state);
  return true;
}

export async function runCheck(config, client) {
  await ensureState(config.dataDir);

  const now = Date.now();
  const stableMs = Number(config.onlineStableSeconds || 90) * 1000;
  const requireOfflineCycle = config.requireOfflineCycle !== false;

  const currentMods = await loadCurrentMods(config);
  const serverOnline = await checkServer(config.host, config.queryPort);

  runtimeStatus.serverOnline = serverOnline;
  runtimeStatus.lastCheckAt = now;

  if (previousServerOnline === null) {
    previousServerOnline = serverOnline;
  }

  // The first successful collection read becomes the baseline. This prevents
  // every existing mod from being falsely announced as newly installed.
  if (!state.initialized) {
    state.initialized = true;
    state.mods = currentMods;
    state.pending = {};
    resetRestartState();
    await store.save(state);

    console.log(
      `[STATE] Baseline created with ${Object.keys(currentMods).length} tracked mods.`
    );
    return;
  }

  const pendingChangedThisRun = detectModChanges(currentMods, now);
  const hasPending = Object.keys(state.pending).length > 0;

  if (!hasPending) {
    resetRestartState();
  } else if (pendingChangedThisRun) {
    state.restart.requiresOfflineCycle = requireOfflineCycle;
    state.restart.offlineSeen = requireOfflineCycle ? !serverOnline : true;
    state.restart.onlineSince = null;

    console.log(
      requireOfflineCycle
        ? '[STATE] New mod change detected. Waiting for the server restart cycle.'
        : '[STATE] New mod change detected. Offline cycle is disabled.'
    );
  }

  // No restart detection requested: send as soon as the server is online.
  if (hasPending && !requireOfflineCycle && serverOnline) {
    await store.save(state);
    await announcePending(config, client);
    previousServerOnline = true;
    return;
  }

  if (!serverOnline) {
    if (previousServerOnline !== false) {
      console.log('[SERVER] Server is now offline.');
    }

    if (hasPending && state.restart.requiresOfflineCycle) {
      state.restart.offlineSeen = true;
      state.restart.onlineSince = null;
      console.log('[STATE] Offline state after pending mod changes detected.');
    }

    previousServerOnline = false;
    await store.save(state);
    return;
  }

  if (previousServerOnline === false) {
    console.log('[SERVER] Server is online again.');

    if (
      hasPending &&
      state.restart.requiresOfflineCycle &&
      state.restart.offlineSeen
    ) {
      state.restart.onlineSince = now;
      console.log('[STATE] Stable-online timer after restart started.');
    }
  }

  if (
    hasPending &&
    state.restart.requiresOfflineCycle &&
    state.restart.offlineSeen &&
    state.restart.onlineSince === null
  ) {
    state.restart.onlineSince = now;
  }

  const isStableOnline =
    state.restart.onlineSince !== null &&
    now - state.restart.onlineSince >= stableMs;

  await store.save(state);

  if (
    hasPending &&
    state.restart.requiresOfflineCycle &&
    state.restart.offlineSeen &&
    isStableOnline
  ) {
    await announcePending(config, client);
  }

  previousServerOnline = true;
}
