import { getWorkshopDetails } from '../services/steam.js';
import { checkServer } from '../services/server.js';
import { createModEmbed } from '../services/embed.js';

const lastKnownWorkshopUpdates = new Map();
const pendingUpdates = new Map();

let previousServerOnline = null;
let sawOfflineAfterPending = false;
let onlineSince = null;

export async function runCheck(config, client) {
  const mods = await getWorkshopDetails(config.modIds);
  const serverOnline = await checkServer(config.host, config.queryPort);
  const now = Date.now();
  const stableMs = Number(process.env.ONLINE_STABLE_SECONDS || 90) * 1000;

  if (previousServerOnline === null) {
    previousServerOnline = serverOnline;
  }

  for (const mod of mods) {
    const modId = String(mod.id);
    const currentUpdated = Number(mod.updated);

    if (!lastKnownWorkshopUpdates.has(modId)) {
      lastKnownWorkshopUpdates.set(modId, currentUpdated);
      continue;
    }

    const lastUpdated = lastKnownWorkshopUpdates.get(modId);

    if (currentUpdated > lastUpdated) {
      lastKnownWorkshopUpdates.set(modId, currentUpdated);

      pendingUpdates.set(modId, {
        ...mod,
        detectedAt: now
      });

      console.log(
        `[MOD DETECTED] ${mod.title} (${modId}) wurde im Workshop aktualisiert und als pending markiert.`
      );
    }
  }

  if (!serverOnline) {
    if (previousServerOnline !== false) {
      console.log('[SERVER] Server ist jetzt offline.');
    }

    if (pendingUpdates.size > 0) {
      sawOfflineAfterPending = true;
    }

    onlineSince = null;
    previousServerOnline = false;
    return;
  }

  if (previousServerOnline === false && serverOnline === true) {
    console.log('[SERVER] Server ist wieder online.');
    onlineSince = now;
  }

  if (serverOnline && onlineSince === null) {
    onlineSince = now;
  }

  const isStableOnline = onlineSince !== null && now - onlineSince >= stableMs;

  if (pendingUpdates.size > 0 && sawOfflineAfterPending && isStableOnline) {
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
      console.log(`[ANNOUNCED] ${mod.title} wurde nach Restart als installiert gemeldet.`);
    }

    pendingUpdates.clear();
    sawOfflineAfterPending = false;
  }

  previousServerOnline = true;
}
