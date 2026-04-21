import fetch from "node-fetch";

export async function getWorkshopDetails(ids) {
  const body = new URLSearchParams();
  body.append("itemcount", ids.length);

  ids.forEach((id, i) => {
    body.append(`publishedfileids[${i}]`, id);
  });

  const res = await fetch(
    "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/",
    {
      method: "POST",
      body,
    }
  );

  const data = await res.json();

  return data.response.publishedfiledetails.map((mod) => ({
    id: mod.publishedfileid,
    title: mod.title,
    updated: mod.time_updated,
    preview: mod.preview_url,
    url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${mod.publishedfileid}`,
  }));
}
