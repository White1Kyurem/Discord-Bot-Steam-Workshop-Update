import { getWorkshopDetails } from '../services/steam.js';
import { checkServer } from '../services/server.js';
import { createModEmbed } from '../services/embed.js';

const lastKnownWorkshopUpdates = new Map();
const pendingUpdates = new Map();

let previousServerOnline = null;

// Diese Flags gelten immer nur für den AKTUELLEN Pending-Batch
let requiresOfflineCycleForPending = false;
let offlineSeenAfterPending = false;
let onlineSinceAfterPendingRestart = null;

export function getMonitorStatus() {
  return {
    pendingCount: pendingUpdates.size,
    requiresOfflineCycleForPending,
    offlineSeenAfterPending,
    onlineSinceAfterPendingRestart
  };
}

export async function runCheck(config, client) {
  const mods = await getWorkshopDetails(config.modIds);
  const serverOnline = await checkServer(config.host, config.queryPort);
  const now = Date.now();
  const stableMs = Number(process.env.ONLINE_STABLE_SECONDS || 90) * 1000;

  if (previousServerOnline === null) {
    previousServerOnline = serverOnline;
  }

  let detectedNewPendingThisRun = false;

  // 1) Workshop-Änderungen erkennen und als pending markieren
  for (const mod of mods) {
    const modId = String(mod.id);
    const currentUpdated = Number(mod.updated);

    if (!lastKnownWorkshopUpdates.has(modId)) {
      lastKnownWorkshopUpdates.set(modId, currentUpdated);
      continue;
    }

    const previousUpdated = lastKnownWorkshopUpdates.get(modId);

    if (currentUpdated > previousUpdated) {
      lastKnownWorkshopUpdates.set(modId, currentUpdated);

      pendingUpdates.set(modId, {
        ...mod,
        detectedAt: now
      });

      detectedNewPendingThisRun = true;

      console.log(
        `[MOD DETECTED] ${mod.title} (${modId}) wurde im Workshop aktualisiert und als pending markiert.`
      );
    }
  }

  // 2) Wenn NEUE pending Updates erkannt wurden, muss für DIESE Updates
  // ein neuer Offline-Zyklus stattfinden. Alte Offline-Zustände zählen nicht mehr.
  if (detectedNewPendingThisRun) {
    requiresOfflineCycleForPending = true;
    offlineSeenAfterPending = false;
    onlineSinceAfterPendingRestart = null;

    console.log('[STATE] Neuer Pending-Batch erkannt. Warte auf neuen Offline-Zyklus.');
  }

  // 3) Serverstatus auswerten
  if (!serverOnline) {
    if (previousServerOnline !== false) {
      console.log('[SERVER] Server ist jetzt offline.');
    }

    // Offline zählt nur, wenn wir aktuell wirklich auf einen neuen Offline-Zyklus warten
    if (pendingUpdates.size > 0 && requiresOfflineCycleForPending) {
      offlineSeenAfterPending = true;
      onlineSinceAfterPendingRestart = null;
      console.log('[STATE] Offline nach Pending erkannt.');
    }

    previousServerOnline = false;
    return;
  }

  // Server ist online
  if (previousServerOnline === false && serverOnline === true) {
    console.log('[SERVER] Server ist wieder online.');

    if (pendingUpdates.size > 0 && requiresOfflineCycleForPending && offlineSeenAfterPending) {
      onlineSinceAfterPendingRestart = now;
      console.log('[STATE] Online-Phase nach Pending-Restart gestartet.');
    }
  }

  // Falls onlineSince noch nicht gesetzt wurde, aber wir schon in der relevanten Online-Phase sind
  if (
    serverOnline &&
    pendingUpdates.size > 0 &&
    requiresOfflineCycleForPending &&
    offlineSeenAfterPending &&
    onlineSinceAfterPendingRestart === null
  ) {
    onlineSinceAfterPendingRestart = now;
  }

  const isStableOnline =
    onlineSinceAfterPendingRestart !== null &&
    now - onlineSinceAfterPendingRestart >= stableMs;

  // 4) Erst senden, wenn:
  // - pending Updates existieren
  // - für diese Updates ein neuer Offline-Zyklus gesehen wurde
  // - der Server danach stabil online war
  if (
    pendingUpdates.size > 0 &&
    requiresOfflineCycleForPending &&
    offlineSeenAfterPending &&
    isStableOnline
  ) {
    if (!config.channelId) {
      console.warn('[WARN] Pending Updates vorhanden, aber keine channelId gesetzt.');
      previousServerOnline = true;
      return;
    }

    const channel = await client.channels.fetch(config.channelId);

    if (!channel || !channel.isTextBased()) {
      console.warn('[WARN] Zielchannel nicht gefunden oder nicht textbasiert.');
      previousServerOnline = true;
      return;
    }

    for (const [, mod] of pendingUpdates) {
      await channel.send({ embeds: [createModEmbed(mod)] });
      console.log(`[ANNOUNCED] ${mod.title} wurde nach neuem Restart als installiert gemeldet.`);
    }

    pendingUpdates.clear();
    requiresOfflineCycleForPending = false;
    offlineSeenAfterPending = false;
    onlineSinceAfterPendingRestart = null;

    console.log('[STATE] Pending-Batch abgeschlossen und zurückgesetzt.');
  }

  previousServerOnline = true;
}
