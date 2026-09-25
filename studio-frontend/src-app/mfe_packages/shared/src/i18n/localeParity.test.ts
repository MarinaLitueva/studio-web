/**
 * Every key of a screen's `en.json` is in its `ru.json`.
 *
 * `loadScreenTranslations` shows English where a locale is missing a key, so a
 * forgotten Russian string no longer renders as a raw key — it renders as
 * English, and nothing else would notice. Three such keys went unnoticed for a
 * month before the loader existed.
 *
 * Every MFE on `loadScreenTranslations` — all but the `_blank-mfe` template.
 * Only `ru`: the other locales are English copies.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MFES = ['projects-mfe', 'connections-mfe', 'organization-mfe', 'kits-mfe', 'people-mfe', 'search-mfe'];

const read = (file: string): Record<string, string> => JSON.parse(readFileSync(file, 'utf8'));

const screens = MFES.flatMap((mfe) => {
  const root = path.join(PACKAGES, mfe, 'src', 'screens');
  return readdirSync(root)
    .map((screen) => path.join(root, screen, 'i18n'))
    .filter((dir) => existsSync(path.join(dir, 'en.json')))
    .map((dir) => ({ name: path.relative(PACKAGES, dir), dir }));
});

describe('ru.json keeps up with en.json', () => {
  it('finds the screens it checks', () => {
    expect(screens.length).toBeGreaterThan(0);
  });

  it.each(screens)('$name', ({ dir }) => {
    const en = read(path.join(dir, 'en.json'));
    const ru = existsSync(path.join(dir, 'ru.json')) ? read(path.join(dir, 'ru.json')) : {};
    expect(Object.keys(en).filter((key) => !(key in ru))).toEqual([]);
  });
});
