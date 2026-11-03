import test from 'node:test';
import assert from 'node:assert/strict';

import {
  decodeMetaTimestamp,
  getInstalledItemsFromVdf,
  matchesInstalledVersion,
  parseMetaCpp
} from '../src/services/server-workshop.js';

const sampleManifest = `
"AppWorkshop"
{
  "appid" "221100"
  "WorkshopItemsInstalled"
  {
    "1559212036"
    {
      "manifest" "12345678901234567890"
      "size" "100"
      "timeupdated" "1770000000"
    }
  }
}
`;

test('parses installed Workshop items without losing 64-bit manifest IDs', () => {
  const items = getInstalledItemsFromVdf(sampleManifest);

  assert.deepEqual(items.get('1559212036'), {
    manifest: '12345678901234567890',
    updated: 1770000000,
    source: 'acf'
  });
});

test('parses a DayZ meta.cpp and decodes its .NET timestamp', () => {
  const meta = parseMetaCpp(`
    protocol = 1;
    publishedid = 1559212036;
    name = "Community Framework";
    timestamp = 5249743004478005813;
  `);

  assert.deepEqual(meta, {
    id: '1559212036',
    name: 'Community Framework',
    timestamp: '5249743004478005813',
    updated: 1670101805
  });
  assert.equal(decodeMetaTimestamp('not-a-number'), 0);
});

test('accepts only the exact installed Workshop manifest', () => {
  const installed = getInstalledItemsFromVdf(sampleManifest).get('1559212036');

  assert.equal(
    matchesInstalledVersion(
      { manifest: '12345678901234567890', updated: 1770000000 },
      installed
    ),
    true
  );

  assert.equal(
    matchesInstalledVersion(
      { manifest: '99999999999999999999', updated: 1770000000 },
      installed
    ),
    false
  );
});

test('does not confirm a mod missing from the installed manifest', () => {
  assert.equal(
    matchesInstalledVersion(
      { manifest: '12345678901234567890', updated: 1770000000 },
      undefined
    ),
    false
  );
});

test('accepts a server meta.cpp timestamp close to the Workshop update time', () => {
  const installed = {
    manifest: '',
    updated: 1770000120,
    source: 'meta'
  };

  assert.equal(
    matchesInstalledVersion(
      { manifest: '12345678901234567890', updated: 1770000000 },
      installed,
      300
    ),
    true
  );

  assert.equal(
    matchesInstalledVersion(
      { manifest: '12345678901234567890', updated: 1770000000 },
      installed
    ),
    false
  );

  assert.equal(
    matchesInstalledVersion(
      { manifest: '12345678901234567890', updated: 1769999000 },
      installed,
      300
    ),
    false
  );
});

test('never replaces an available exact ACF manifest check with time matching', () => {
  assert.equal(
    matchesInstalledVersion(
      { manifest: 'expected', updated: 1770000000 },
      {
        manifest: 'different',
        updated: 1770000000,
        source: 'acf'
      },
      300
    ),
    false
  );
});
