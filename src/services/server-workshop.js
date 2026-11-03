import SftpClient from 'ssh2-sftp-client';

function safeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

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
      updated: Number(details.timeupdated || 0)
    });
  }

  return items;
}

export function matchesInstalledVersion(workshopMod, installedMod) {
  if (!installedMod) return false;

  const expectedManifest = safeString(workshopMod?.manifest);
  const installedManifest = safeString(installedMod?.manifest);

  if (expectedManifest) {
    return Boolean(installedManifest) && installedManifest === expectedManifest;
  }

  const expectedUpdated = Number(workshopMod?.updated || 0);
  const installedUpdated = Number(installedMod?.updated || 0);

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
        const contents = await sftp.get(remotePath);
        const text = Buffer.isBuffer(contents)
          ? contents.toString('utf8')
          : String(contents);

        return {
          path: remotePath,
          items: getInstalledItemsFromVdf(text)
        };
      } catch (error) {
        failures.push(`${remotePath}: ${error?.message || error}`);
      }
    }

    const discovery = await findManifestPath(sftp, config);

    if (discovery.path) {
      const contents = await sftp.get(discovery.path);
      const text = Buffer.isBuffer(contents)
        ? contents.toString('utf8')
        : String(contents);

      return {
        path: discovery.path,
        items: getInstalledItemsFromVdf(text)
      };
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
