import test from 'node:test';
import assert from 'node:assert/strict';

import {
  decodeMetaTimestamp,
  getInstalledItemsFromVdf,
  getInstalledVersionKey,
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

test('accepts a newer installed meta.cpp than the saved server baseline', () => {
  const newerInstalled = {
    manifest: '',
    updated: 1670101806,
    source: 'meta',
    metaTimestamp: '5249743004488005813'
  };
  const unchangedInstalled = {
    ...newerInstalled,
    updated: 1670101805,
    metaTimestamp: '5249743004478005813'
  };
  const baseline = getInstalledVersionKey(unchangedInstalled);

  assert.equal(baseline, 'meta:5249743004478005813');

  assert.equal(
    matchesInstalledVersion(
      { manifest: '12345678901234567890', updated: 1770000000 },
      newerInstalled,
      baseline
    ),
    true
  );

  assert.equal(
    matchesInstalledVersion(
      { manifest: '12345678901234567890', updated: 1770000000 },
      unchangedInstalled,
      baseline
    ),
    false
  );

  assert.equal(
    matchesInstalledVersion(
      { manifest: '12345678901234567890', updated: 1770000000 },
      newerInstalled,
      ''
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
      }
    ),
    false
  );
});
