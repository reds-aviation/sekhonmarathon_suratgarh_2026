import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';

test('Public Sans ships real static regular, semibold and bold faces for Safari', async () => {
  const faces = [
    ['public-sans-latin.woff2', 'Regular'],
    ['public-sans-semibold.woff2', 'SemiBold'],
    ['public-sans-bold.woff2', 'Bold'],
  ];
  const outlines = [];
  for (const [filename, style] of faces) {
    const font = fontkit.create(await readFile(new URL(`../public/fonts/${filename}`, import.meta.url)));
    assert.equal(font.familyName, 'Public Sans');
    assert.equal(font.subfamilyName, style);
    assert.deepEqual(font.variationAxes, {});
    outlines.push(font.glyphForCodePoint(72).path.toSVG());
  }
  assert.notEqual(outlines[0], outlines[1]);
  assert.notEqual(outlines[1], outlines[2]);
  const css = await readFile(new URL('../app/station-theme.css', import.meta.url), 'utf8');
  assert.match(css, /font-weight: 400;[\s\S]*?public-sans-latin\.woff2/u);
  assert.match(css, /font-weight: 600;[\s\S]*?public-sans-semibold\.woff2/u);
  assert.match(css, /font-weight: 700;[\s\S]*?public-sans-bold\.woff2/u);
  assert.doesNotMatch(css, /font-weight: 100 900/u);
});
