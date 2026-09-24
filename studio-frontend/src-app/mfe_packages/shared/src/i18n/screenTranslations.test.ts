import { describe, expect, it, vi } from 'vitest';
import { loadScreenTranslations, type TranslationModules } from './screenTranslations';

const DIR = './screens/list/i18n';

function modules(files: Record<string, Record<string, string>>): TranslationModules {
  return Object.fromEntries(
    Object.entries(files).map(([language, dict]) => [
      `${DIR}/${language}.json`,
      vi.fn(async () => ({ default: dict })),
    ])
  );
}

describe('loadScreenTranslations', () => {
  it('puts English under a key the locale file is missing', async () => {
    const load = loadScreenTranslations(
      modules({ en: { title: 'Projects', load_failed: 'Could not load' }, ru: { title: 'Проекты' } }),
      DIR
    );
    expect(await load('ru')).toEqual({ title: 'Проекты', load_failed: 'Could not load' });
  });

  it('answers a language with no file in English, not with nothing', async () => {
    const load = loadScreenTranslations(modules({ en: { title: 'Projects' } }), DIR);
    expect(await load('de')).toEqual({ title: 'Projects' });
  });

  it('reads English once for English', async () => {
    const files = modules({ en: { title: 'Projects' } });
    await loadScreenTranslations(files, DIR)('en');
    expect(files[`${DIR}/en.json`]).toHaveBeenCalledTimes(1);
  });

  it('keeps the locale value where both have the key', async () => {
    const load = loadScreenTranslations(
      modules({ en: { title: 'Projects' }, ru: { title: 'Проекты' } }),
      DIR
    );
    expect((await load('ru')).title).toBe('Проекты');
  });
});
