import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getInstalledItemsFromVdf,
  matchesInstalledVersion
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
    updated: 1770000000
  });
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
