import fetch from 'node-fetch';

export async function getWorkshopDetails(ids) {
  const body = new URLSearchParams();
  body.append('itemcount', ids.length);

  ids.forEach((id, i) => {
    body.append(`publishedfileids[${i}]`, id);
  });

  const res = await fetch(
    'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/',
    {
      method: 'POST',
      body
    }
  );

  if (!res.ok) {
    throw new Error(`Steam Workshop API returned HTTP ${res.status}.`);
  }

  const data = await res.json();
  const details = data?.response?.publishedfiledetails;

  if (!Array.isArray(details)) {
    throw new Error('Steam Workshop API returned an invalid response.');
  }

  return details
    .filter((mod) => Number(mod.result) === 1 && mod.publishedfileid)
    .map((mod) => ({
      id: String(mod.publishedfileid),
      title: mod.title || `Workshop Mod ${mod.publishedfileid}`,
      updated: Number(mod.time_updated || 0),
      manifest: String(mod.hcontent_file || ''),
      preview: mod.preview_url,
      url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${mod.publishedfileid}`
    }));
}

