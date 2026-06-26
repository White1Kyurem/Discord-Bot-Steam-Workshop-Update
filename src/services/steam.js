import fetch from 'node-fetch';

const COLLECTION_DETAILS_URL =
  'https://api.steampowered.com/ISteamRemoteStorage/GetCollectionDetails/v1/';
const FILE_DETAILS_URL =
  'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/';

async function postSteamForm(url, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      body,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Steam API returned HTTP ${response.status}.`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function getCollectionChildren(collectionId) {
  const body = new URLSearchParams();
  body.append('collectioncount', '1');
  body.append('publishedfileids[0]', String(collectionId));

  const data = await postSteamForm(COLLECTION_DETAILS_URL, body);
  const collection = data?.response?.collectiondetails?.[0];

  if (!collection || Number(collection.result) !== 1) {
    throw new Error(
      `Steam Workshop collection ${collectionId} could not be loaded.`
    );
  }

  return Array.isArray(collection.children) ? collection.children : [];
}

/**
 * Returns every mod ID from a Steam Workshop collection.
 * Nested collections are resolved automatically as well.
 */
export async function getCollectionModIds(collectionId) {
  if (!collectionId) return [];

  const modIds = new Set();
  const visitedCollections = new Set();

  async function visit(id, depth = 0) {
    const normalizedId = String(id).trim();

    if (!normalizedId || visitedCollections.has(normalizedId)) return;
    if (depth > 8) {
      throw new Error('Maximum nested Steam collection depth exceeded.');
    }

    visitedCollections.add(normalizedId);
    const children = await getCollectionChildren(normalizedId);

    for (const child of children) {
      const childId = String(child.publishedfileid || '').trim();
      if (!childId) continue;

      // Steam uses filetype 2 for collections. Missing/unknown types are
      // treated as normal Workshop items so no actual mod is skipped.
      if (Number(child.filetype) === 2) {
        await visit(childId, depth + 1);
      } else {
        modIds.add(childId);
      }
    }
  }

  await visit(collectionId);
  return [...modIds];
}

/**
 * Loads exact Workshop names, update timestamps and preview images.
 * Requests are split into batches to support large collections.
 */
export async function getWorkshopDetails(ids) {
  const normalizedIds = [...new Set(ids.map(String).map((id) => id.trim()))]
    .filter(Boolean);

  if (normalizedIds.length === 0) return [];

  const details = [];
  const batchSize = 100;

  for (let offset = 0; offset < normalizedIds.length; offset += batchSize) {
    const batch = normalizedIds.slice(offset, offset + batchSize);
    const body = new URLSearchParams();
    body.append('itemcount', String(batch.length));

    batch.forEach((id, index) => {
      body.append(`publishedfileids[${index}]`, id);
    });

    const data = await postSteamForm(FILE_DETAILS_URL, body);
    const publishedFiles = data?.response?.publishedfiledetails;

    if (!Array.isArray(publishedFiles)) {
      throw new Error('Steam Workshop details response is invalid.');
    }

    for (const mod of publishedFiles) {
      if (Number(mod.result) !== 1 || !mod.publishedfileid) continue;

      const id = String(mod.publishedfileid);
      details.push({
        id,
        title: mod.title || `Workshop Item ${id}`,
        updated: Number(mod.time_updated || 0),
        preview: mod.preview_url || null,
        url: `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`
      });
    }
  }

  return details;
}
