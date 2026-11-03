import fs from 'node:fs/promises';
import path from 'node:path';

import { getWorkshopDetails } from '../services/steam.js';
import { checkServer } from '../services/server.js';
import {
  getInstalledVersionKey,
  getInstalledWorkshopState,
  matchesInstalledVersion
} from '../services/server-workshop.js';
import { createModEmbed } from '../services/embed.js';

const STATE_FILE_NAME = 'steam-update-monitor-state.json';
const lastKnownWorkshopVersions = new Map();
const pendingUpdates = new Map();
const installedVersionSnapshot = new Map();

let stateLoaded = false;
let loadedStatePath = '';
let previousServerOnline = null;
let lastVerificationAt = null;
let lastVerificationError = '';
let lastManifestPath = '';
let lastInstalledSnapshotAt = null;
let lastInstalledSnapshotError = '';

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getVersionKey(mod) {
  const manifest = String(mod.manifest || '').trim();
  if (manifest) return `manifest:${manifest}`;
  return `updated:${safeNumber(mod.updated)}`;
}

function getStateFile(config) {
  const dataDir = String(config.dataDir || './data').trim() || './data';
  return path.resolve(dataDir, STATE_FILE_NAME);
}

async function loadState(config) {
  const stateFile = getStateFile(config);
  if (stateLoaded && loadedStatePath === stateFile) return;

  lastKnownWorkshopVersions.clear();
  pendingUpdates.clear();
  installedVersionSnapshot.clear();
  previousServerOnline = null;
  lastVerificationAt = null;
  lastVerificationError = '';
  lastManifestPath = '';
  lastInstalledSnapshotAt = null;
  lastInstalledSnapshotError = '';

  try {
    const raw = await fs.readFile(stateFile, 'utf8');
    const parsed = JSON.parse(raw);

    for (const [modId, version] of Object.entries(parsed.lastKnown || {})) {
      lastKnownWorkshopVersions.set(String(modId), String(version));
    }

    for (const [modId, pending] of Object.entries(parsed.pending || {})) {
      if (!pending || typeof pending !== 'object') continue;

      pendingUpdates.set(String(modId), {
        ...pending,
        id: String(pending.id || modId),
        manifest: String(pending.manifest || ''),
        updated: safeNumber(pending.updated),
        detectedAt: safeNumber(pending.detectedAt, Date.now()),
        offlineSeen: Boolean(pending.offlineSeen),
        onlineSince: pending.onlineSince
          ? safeNumber(pending.onlineSince)
          : null,
        installedAtOnline: Boolean(pending.installedAtOnline),
        baselineInstalledVersion: String(
          pending.baselineInstalledVersion || ''
        ),
        installedSource: String(pending.installedSource || ''),
        installedUpdated: safeNumber(pending.installedUpdated)
      });
    }

    for (const [modId, version] of Object.entries(
      parsed.installedSnapshot || {}
    )) {
      const normalized = String(version || '');
      if (normalized) {
        installedVersionSnapshot.set(String(modId), normalized);
      }
    }

    previousServerOnline =
      typeof parsed.previousServerOnline === 'boolean'
        ? parsed.previousServerOnline
        : null;
    lastVerificationAt = parsed.lastVerificationAt || null;
    lastVerificationError = String(parsed.lastVerificationError || '');
    lastManifestPath = String(parsed.lastManifestPath || '');
    lastInstalledSnapshotAt = parsed.lastInstalledSnapshotAt || null;
    lastInstalledSnapshotError = String(
      parsed.lastInstalledSnapshotError || ''
    );
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error('[STATE] Failed to load monitor state:', error);
    }
  }

  stateLoaded = true;
  loadedStatePath = stateFile;
}

async function saveState(config) {
  const stateFile = getStateFile(config);
  const stateDir = path.dirname(stateFile);
  const temporaryFile = `${stateFile}.tmp`;

  const payload = {
    version: 3,
    savedAt: new Date().toISOString(),
    previousServerOnline,
    lastVerificationAt,
    lastVerificationError,
    lastManifestPath,
    lastInstalledSnapshotAt,
    lastInstalledSnapshotError,
    lastKnown: Object.fromEntries(lastKnownWorkshopVersions),
    pending: Object.fromEntries(pendingUpdates),
    installedSnapshot: Object.fromEntries(installedVersionSnapshot)
  };

  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(temporaryFile, JSON.stringify(payload, null, 2), 'utf8');
  await fs.rename(temporaryFile, stateFile);
}

function countPending(predicate) {
  return [...pendingUpdates.values()].filter(predicate).length;
}

export function getMonitorStatus() {
  return {
    pendingCount: pendingUpdates.size,
    awaitingOfflineCount: countPending((pending) => !pending.offlineSeen),
    offlineSeenCount: countPending(
      (pending) => pending.offlineSeen && !pending.onlineSince
    ),
    verifiedAtOnlineCount: countPending(
      (pending) => pending.installedAtOnline && pending.onlineSince
    ),
    lastVerificationAt,
    lastVerificationError,
    lastManifestPath,
    installedSnapshotCount: installedVersionSnapshot.size,
    lastInstalledSnapshotAt,
    lastInstalledSnapshotError
  };
}

function hasSftpConfig(config) {
  return Boolean(
    config?.sftp?.host &&
      config?.sftp?.username &&
      config?.sftp?.password
  );
}

async function readInstalledState(config, now) {
  if (!hasSftpConfig(config)) return null;

  try {
    const installedState = await getInstalledWorkshopState(config.sftp);
    lastInstalledSnapshotAt = new Date(now).toISOString();
    lastInstalledSnapshotError = '';
    lastManifestPath = installedState.path;
    return installedState;
  } catch (error) {
    lastInstalledSnapshotAt = new Date(now).toISOString();
    lastInstalledSnapshotError = (error?.message || String(error)).slice(
      0,
      700
    );
    console.error('[SNAPSHOT] Could not read installed mod versions:', error);
    return null;
  }
}

function updateInstalledSnapshot(installedState) {
  if (!installedState) return;

  installedVersionSnapshot.clear();

  for (const [modId, installed] of installedState.items) {
    const version = getInstalledVersionKey(installed);
    if (version) installedVersionSnapshot.set(String(modId), version);
  }
}

function fillMissingPendingBaselines(installedState) {
  if (!installedState) return;

  for (const pending of pendingUpdates.values()) {
    if (pending.baselineInstalledVersion || pending.offlineSeen) continue;

    const installed = installedState.items.get(String(pending.id));
    const version = getInstalledVersionKey(installed);
    if (version) pending.baselineInstalledVersion = version;
  }
}

async function captureInstalledVersionsAtServerStart(
  now,
  installedState = null
) {
  const eligible = [...pendingUpdates.values()].filter(
    (pending) => pending.offlineSeen
  );

  if (!eligible.length) return installedState;

  try {
    if (!installedState) {
      throw new Error(
        lastInstalledSnapshotError ||
          'No readable installed-mod snapshot was available at server start.'
      );
    }

    const verifiedState = installedState;
    lastVerificationAt = new Date(now).toISOString();
    lastVerificationError = '';
    lastManifestPath = verifiedState.path;

    for (const pending of eligible) {
      const installed = verifiedState.items.get(String(pending.id));
      const verified = matchesInstalledVersion(
        pending,
        installed,
        pending.baselineInstalledVersion
      );

      if (verified) {
        pending.installedAtOnline = true;
        pending.onlineSince = now;
        pending.installedManifest = String(installed?.manifest || '');
        pending.installedSource = String(installed?.source || 'unknown');
        pending.installedUpdated = safeNumber(installed?.updated);

        console.log(
          `[VERIFIED] ${pending.title} (${pending.id}) was installed before the server came online (${pending.installedSource}).`
        );
      } else {
        pending.offlineSeen = false;
        pending.installedAtOnline = false;
        pending.onlineSince = null;
        pending.installedManifest = String(installed?.manifest || '');
        pending.installedSource = String(installed?.source || 'missing');
        pending.installedUpdated = safeNumber(installed?.updated);

        console.log(
          `[WAITING] ${pending.title} (${pending.id}) did not have a newer verified server version at startup. Waiting for the next offline cycle.`
        );
      }
    }

    return verifiedState;
  } catch (error) {
    lastVerificationAt = new Date(now).toISOString();
    lastVerificationError = (error?.message || String(error)).slice(0, 700);

    // A restart without a readable manifest is not accepted as proof.
    // Requiring another offline cycle prevents a delayed SFTP read from
    // incorrectly treating a post-start download as active on the server.
    for (const pending of eligible) {
      pending.offlineSeen = false;
      pending.installedAtOnline = false;
      pending.onlineSince = null;
    }

    console.error(
      '[VERIFY] Could not confirm installed Workshop manifests. No update will be announced:',
      error
    );

    return null;
  }
}

async function announceVerifiedUpdates(config, client, now) {
  const stableMs = safeNumber(config.onlineStableMs, 90_000);
  const ready = [...pendingUpdates.entries()].filter(([, pending]) => {
    return (
      pending.installedAtOnline &&
      pending.onlineSince &&
      now - pending.onlineSince >= stableMs
    );
  });

  if (!ready.length || !config.notificationsEnabled) return;

  if (!config.channelId) {
    console.warn('[WARN] Verified updates exist, but ANNOUNCE_CHANNEL_ID is not set.');
    return;
  }

  const channel = await client.channels.fetch(config.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    console.warn('[WARN] Announcement channel was not found or is not text based.');
    return;
  }

  for (const [modId, mod] of ready) {
    try {
      await channel.send({ embeds: [createModEmbed(mod)] });
      pendingUpdates.delete(modId);
      console.log(
        `[ANNOUNCED] ${mod.title} was verified as installed and announced.`
      );
    } catch (error) {
      console.error(
        `[ANNOUNCE] Failed to send the update for ${mod.title} (${modId}):`,
        error
      );
    }
  }
}

export async function runCheck(config, client) {
  await loadState(config);

  const now = Date.now();
  const [mods, serverOnline] = await Promise.all([
    getWorkshopDetails(config.modIds),
    checkServer(config.host, config.queryPort)
  ]);
  let installedState = serverOnline
    ? await readInstalledState(config, now)
    : null;

  for (const mod of mods) {
    const modId = String(mod.id);
    const currentVersion = getVersionKey(mod);

    if (!lastKnownWorkshopVersions.has(modId)) {
      lastKnownWorkshopVersions.set(modId, currentVersion);
      continue;
    }

    const previousVersion = lastKnownWorkshopVersions.get(modId);
    if (currentVersion === previousVersion) continue;

    lastKnownWorkshopVersions.set(modId, currentVersion);
    pendingUpdates.set(modId, {
      ...mod,
      id: modId,
      manifest: String(mod.manifest || ''),
      detectedAt: now,
      offlineSeen: false,
      onlineSince: null,
      installedAtOnline: false,
      installedManifest: '',
      baselineInstalledVersion:
        installedVersionSnapshot.get(modId) || '',
      installedSource: '',
      installedUpdated: 0
    });

    console.log(
      `[MOD DETECTED] ${mod.title} (${modId}) changed in the Workshop. Waiting for a verified server installation.`
    );
  }

  if (previousServerOnline === null) {
    previousServerOnline = serverOnline;
  }

  if (!serverOnline) {
    if (previousServerOnline !== false) {
      console.log('[SERVER] Server is now offline.');
    }

    for (const pending of pendingUpdates.values()) {
      pending.offlineSeen = true;
      pending.onlineSince = null;
      pending.installedAtOnline = false;
    }

    previousServerOnline = false;
    await saveState(config);
    return;
  }

  if (previousServerOnline === false) {
    console.log('[SERVER] Server is online again. Verifying installed manifests.');
    installedState = await captureInstalledVersionsAtServerStart(
      now,
      installedState
    );
  }

  fillMissingPendingBaselines(installedState);
  updateInstalledSnapshot(installedState);
  previousServerOnline = true;
  await announceVerifiedUpdates(config, client, now);
  await saveState(config);
}
