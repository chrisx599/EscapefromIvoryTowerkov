import test from 'node:test';
import assert from 'node:assert/strict';
import { ITEMS } from '../src/content.js';
import { ITEM_ART_URLS, itemIconHtml } from '../public/item-art.js';

test('every current inventory item has a dedicated image mapping', () => {
  assert.deepEqual(Object.keys(ITEM_ART_URLS).sort(), Object.keys(ITEMS).sort());
  for (const item of Object.values(ITEMS)) {
    const html = itemIconHtml(item);
    assert.ok(html.includes(`src="${ITEM_ART_URLS[item.id]}"`), item.id);
    assert.ok(html.includes('alt=""'), 'item name is already visible beside its decorative image');
  }
});

test('canonical IDs identify icons and invalid identifiers never create a source', () => {
  assert.ok(itemIconHtml({ id: 'canvas_pack' }).includes(ITEM_ART_URLS.canvas_pack));
  for (const id of ['unknown', '__proto__', 'constructor', 'toString']) {
    assert.ok(!itemIconHtml({ id }).includes('<img'), id);
  }
  const unsafe = itemIconHtml({ id: '\" onerror=\"bad' }, 'unsafe-css');
  assert.ok(!unsafe.includes('<img'));
  assert.ok(!unsafe.includes('class="unsafe-css"'));
  assert.ok(unsafe.includes('&quot;'));
});
