import { getWorkshopDetails } from "../services/steam.js";
import { checkServer } from "../services/server.js";

let lastUpdates = {};
let serverWasOffline = false;

export async function runCheck(config, client) {
  const mods = await getWorkshopDetails(config.modIds);

  const serverOnline = await checkServer(config.host, config.queryPort);

  if (!serverOnline) {
    serverWasOffline = true;
    return;
  }

  for (const mod of mods) {
    if (!lastUpdates[mod.id]) {
      lastUpdates[mod.id] = mod.updated;
      continue;
    }

    if (mod.updated > lastUpdates[mod.id]) {
      lastUpdates[mod.id] = mod.updated;

      if (serverWasOffline) {
        serverWasOffline = false;
        const channel = await client.channels.fetch(config.channelId);
        const { createModEmbed } = await import("../services/embed.js");
        await channel.send({ embeds: [createModEmbed(mod)] });
      }
    }
  }
}
