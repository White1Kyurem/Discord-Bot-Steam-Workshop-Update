import SftpClient from 'ssh2-sftp-client';

function safeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

const DOTNET_TICKS_AT_UNIX_EPOCH = 621355968000000000n;
const DOTNET_TICKS_PER_SECOND = 10000000n;
const DOTNET_TICKS_MASK = (1n << 62n) - 1n;

function decodeVdfString(token) {
  return token
    .slice(1, -1)
    .replace(/\\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

export function parseVdf(input) {
  const tokens = String(input || '').match(/"(?:\\.|[^"\\])*"|[{}]/g) || [];
  let index = 0;

  function parseObject(expectClosingBrace = false) {
    const result = {};

    while (index < tokens.length) {
      const token = tokens[index++];

      if (token === '}') {
        if (!expectClosingBrace) {
          throw new Error('Unexpected closing brace in Workshop manifest.');
        }
        return result;
      }

      if (!token.startsWith('"')) {
        throw new Error('Invalid key in Workshop manifest.');
      }

      const key = decodeVdfString(token);
      const valueToken = tokens[index++];

      if (valueToken === '{') {
        result[key] = parseObject(true);
      } else if (valueToken?.startsWith('"')) {
        result[key] = decodeVdfString(valueToken);
      } else {
        throw new Error(`Invalid value for "${key}" in Workshop manifest.`);
      }
    }

    if (expectClosingBrace) {
      throw new Error('Missing closing brace in Workshop manifest.');
    }

    return result;
  }

  return parseObject(false);
}

export function getInstalledItemsFromVdf(input) {
  const parsed = parseVdf(input);
  const appWorkshop = parsed.AppWorkshop || parsed;
  const installed = appWorkshop.WorkshopItemsInstalled;

  if (!installed || typeof installed !== 'object') {
    throw new Error(
      'WorkshopItemsInstalled was not found in appworkshop_221100.acf.'
    );
  }

  const items = new Map();

  for (const [modId, details] of Object.entries(installed)) {
    if (!details || typeof details !== 'object') continue;

    items.set(String(modId), {
      manifest: safeString(details.manifest),
      updated: Number(details.timeupdated || 0),
      source: 'acf'
    });
  }

  return items;
}

export function decodeMetaTimestamp(value) {
  const raw = safeString(String(value ?? ''));
  if (!/^-?\d+$/.test(raw)) return 0;

  let encoded;
  try {
    encoded = BigInt(raw);
  } catch {
    return 0;
  }

  let unixSeconds;

  if (encoded > 0n && encoded < (1n << 40n)) {
    unixSeconds = encoded;
  } else {
    const ticks = BigInt.asUintN(64, encoded) & DOTNET_TICKS_MASK;
    if (ticks < DOTNET_TICKS_AT_UNIX_EPOCH) return 0;
    unixSeconds =
      (ticks - DOTNET_TICKS_AT_UNIX_EPOCH) / DOTNET_TICKS_PER_SECOND;
  }

  const numeric = Number(unixSeconds);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) return 0;

  const year = new Date(numeric * 1000).getUTCFullYear();
  if (year < 2000 || year > 2200) return 0;

  return numeric;
}

export function parseMetaCpp(input) {
  const text = String(input || '').replace(/^\uFEFF/, '');
  const publishedId = text.match(
    /\bpublishedid\s*=\s*"?(\d+)"?\s*;/i
  )?.[1];
  const timestamp = text.match(
    /\btimestamp\s*=\s*"?(-?\d+)"?\s*;/i
  )?.[1];
  const name = text.match(/\bname\s*=\s*"([^"]*)"\s*;/i)?.[1] || '';

  if (!publishedId) return null;

  return {
    id: publishedId,
    name,
    timestamp: timestamp || '',
    updated: decodeMetaTimestamp(timestamp || '')
  };
}

export function matchesInstalledVersion(
  workshopMod,
  installedMod,
  metaTimestampToleranceSeconds = 0
) {
  if (!installedMod) return false;

  const expectedManifest = safeString(workshopMod?.manifest);
  const installedManifest = safeString(installedMod?.manifest);

  if (expectedManifest && installedManifest) {
    return installedManifest === expectedManifest;
  }

  const expectedUpdated = Number(workshopMod?.updated || 0);
  const installedUpdated = Number(installedMod?.updated || 0);

  if (
    installedMod.source === 'meta' &&
    Number.isFinite(expectedUpdated) &&
    expectedUpdated > 0 &&
    Number.isFinite(installedUpdated) &&
    installedUpdated > 0
  ) {
    const configuredTolerance = Number(metaTimestampToleranceSeconds || 0);
    const tolerance = Number.isFinite(configuredTolerance)
      ? Math.max(0, configuredTolerance)
      : 0;

    return Math.abs(installedUpdated - expectedUpdated) <= tolerance;
  }

  return (
    Number.isFinite(expectedUpdated) &&
    expectedUpdated > 0 &&
    Number.isFinite(installedUpdated) &&
    installedUpdated >= expectedUpdated
  );
}

function buildManifestCandidates(config) {
  return [
    safeString(config?.workshopAcfPath),
    'steamapps/workshop/appworkshop_221100.acf',
    '/steamapps/workshop/appworkshop_221100.acf',
    'appworkshop_221100.acf'
  ].filter((value, index, values) => value && values.indexOf(value) === index);
}

function joinRemotePath(parent, child) {
  const normalizedParent = safeString(parent).replace(/\/+$/, '');
  if (!normalizedParent || normalizedParent === '.') return child;
  if (normalizedParent === '/') return `/${child}`;
  return `${normalizedParent}/${child}`;
}

function getParentRemotePath(remotePath) {
  const normalized = safeString(remotePath).replace(/\/+$/, '');
  const separator = normalized.lastIndexOf('/');

  if (separator < 0) return '.';
  if (separator === 0) return '/';
  return normalized.slice(0, separator);
}

function inferGameRoot(manifestPath, configuredGameRoot) {
  const override = safeString(configuredGameRoot);
  if (override) return override;

  const normalized = safeString(manifestPath).replace(/\\/g, '/');
  const marker = '/steamapps/workshop/appworkshop_221100.acf';
  const lower = normalized.toLowerCase();
  const markerIndex = lower.lastIndexOf(marker);

  if (markerIndex >= 0) {
    return normalized.slice(0, markerIndex) || '/';
  }

  if (lower === 'steamapps/workshop/appworkshop_221100.acf') {
    return '.';
  }

  return getParentRemotePath(manifestPath);
}

async function getInstalledItemsFromModFolders(sftp, gameRoot) {
  const items = new Map();
  const errors = [];
  let foldersScanned = 0;
  let entries;

  try {
    entries = await sftp.list(gameRoot);
  } catch (error) {
    return {
      items,
      foldersScanned,
      error: `Could not list game root "${gameRoot}": ${
        error?.message || error
      }`
    };
  }

  const modFolders = entries.filter((entry) => {
    const name = safeString(entry?.name);
    return name.startsWith('@') && entry?.type !== '-';
  });

  for (const entry of modFolders) {
    const folder = safeString(entry.name);
    const metaPath = joinRemotePath(joinRemotePath(gameRoot, folder), 'meta.cpp');
    foldersScanned += 1;

    try {
      const contents = await sftp.get(metaPath);
      const text = Buffer.isBuffer(contents)
        ? contents.toString('utf8')
        : String(contents);
      const meta = parseMetaCpp(text);

      if (!meta) {
        errors.push(`${folder}: publishedid missing`);
        continue;
      }

      if (!meta.updated) {
        errors.push(`${folder}: valid timestamp missing`);
        continue;
      }

      items.set(meta.id, {
        manifest: '',
        updated: meta.updated,
        source: 'meta',
        folder,
        name: meta.name,
        metaTimestamp: meta.timestamp
      });
    } catch (error) {
      errors.push(`${folder}: ${error?.message || error}`);
    }
  }

  return {
    items,
    foldersScanned,
    error: errors.length
      ? `${errors.length} mod folder(s) had no readable, valid meta.cpp.`
      : ''
  };
}

async function readInstalledWorkshopState(sftp, manifestPath, config) {
  const contents = await sftp.get(manifestPath);
  const text = Buffer.isBuffer(contents)
    ? contents.toString('utf8')
    : String(contents);
  const acfItems = getInstalledItemsFromVdf(text);
  const gameRoot = inferGameRoot(manifestPath, config?.gameRoot);
  const metaState = await getInstalledItemsFromModFolders(sftp, gameRoot);
  const items = new Map(metaState.items);

  // The ACF contains exact Steam manifest IDs, so it always wins when both
  // sources contain the same Workshop item.
  for (const [modId, item] of acfItems) {
    items.set(modId, item);
  }

  return {
    path: manifestPath,
    gameRoot,
    items,
    acfItems,
    metaItems: metaState.items,
    modFoldersScanned: metaState.foldersScanned,
    metaScanError: metaState.error
  };
}

function shouldSkipDirectory(name) {
  const normalized = safeString(name).toLowerCase();

  return (
    !normalized ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('@') ||
    [
      'keys',
      'logs',
      'mpmissions',
      'profiles',
      'storage_1',
      'backups',
      'backup',
      'battleye'
    ].includes(normalized)
  );
}

async function findManifestPath(sftp, config) {
  const searchRoot = safeString(config?.searchRoot) || '.';
  const maximumDepth = Math.max(0, Number(config?.searchDepth || 6));
  const maximumDirectories = Math.max(
    1,
    Number(config?.searchMaxDirectories || 300)
  );
  const targetName = 'appworkshop_221100.acf';
  const queue = [{ path: searchRoot, depth: 0 }];
  const visited = new Set();
  let rootEntries = [];

  while (queue.length && visited.size < maximumDirectories) {
    const current = queue.shift();
    if (!current || visited.has(current.path)) continue;

    visited.add(current.path);

    let entries;
    try {
      entries = await sftp.list(current.path);
    } catch {
      continue;
    }

    if (current.depth === 0) {
      rootEntries = entries
        .map((entry) => entry.name)
        .filter(Boolean)
        .slice(0, 80);
    }

    const manifestEntry = entries.find(
      (entry) =>
        entry.type !== 'd' &&
        safeString(entry.name).toLowerCase() === targetName
    );

    if (manifestEntry) {
      return {
        path: joinRemotePath(current.path, manifestEntry.name),
        scannedDirectories: visited.size,
        rootEntries
      };
    }

    if (current.depth >= maximumDepth) continue;

    for (const entry of entries) {
      if (entry.type !== 'd' || shouldSkipDirectory(entry.name)) continue;

      queue.push({
        path: joinRemotePath(current.path, entry.name),
        depth: current.depth + 1
      });
    }
  }

  return {
    path: '',
    scannedDirectories: visited.size,
    rootEntries
  };
}

export async function getInstalledWorkshopState(config = {}) {
  const host = safeString(config.host);
  const username = safeString(config.username);
  const password = safeString(config.password);

  if (!host || !username || !password) {
    throw new Error(
      'SFTP verification is not configured. Set SERVER_SFTP_HOST, SERVER_SFTP_USERNAME and SERVER_SFTP_PASSWORD.'
    );
  }

  const sftp = new SftpClient('project-blackout-workshop-verifier');
  let connected = false;

  try {
    await sftp.connect({
      host,
      port: Number(config.port || 22),
      username,
      password,
      readyTimeout: Number(config.readyTimeout || 20_000),
      keepaliveInterval: 10_000,
      keepaliveCountMax: 2
    });
    connected = true;

    const candidates = buildManifestCandidates(config);
    const failures = [];

    for (const remotePath of candidates) {
      try {
        return await readInstalledWorkshopState(sftp, remotePath, config);
      } catch (error) {
        failures.push(`${remotePath}: ${error?.message || error}`);
      }
    }

    const discovery = await findManifestPath(sftp, config);

    if (discovery.path) {
      return await readInstalledWorkshopState(sftp, discovery.path, config);
    }

    const visibleRoot = discovery.rootEntries.length
      ? discovery.rootEntries.join(', ')
      : '(no entries could be listed)';

    throw new Error(
      'Could not find appworkshop_221100.acf in the accessible SFTP area. ' +
        `Direct paths failed and ${discovery.scannedDirectories} directories were scanned. ` +
        `Visible entries in "${safeString(config.searchRoot) || '.'}": ${visibleRoot}. ` +
        'Direct checks: ' +
        failures.join(' | ')
    );
  } finally {
    if (connected) {
      await sftp.end().catch(() => null);
    }
  }
}
