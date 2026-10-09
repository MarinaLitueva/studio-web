import { describe, expect, it } from 'vitest';
import { pluralForm, screenText } from './screenText';

/** A translator the way FrontX's answers: `<namespace>:<key>` for a missing key. */
const translator =
  (dictionary: Record<string, string>) => (key: string, params?: Record<string, unknown>) =>
    key in dictionary
      ? dictionary[key]!.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''))
      : `screen.test:${key}`;

const ru = {
  n_one: '{count} воркспейс',
  n_few: '{count} воркспейса',
  n_many: '{count} воркспейсов',
};

describe('pluralForm', () => {
  it('follows the Russian rule, not "one or not one"', () => {
    expect([1, 2, 5, 11, 21, 22].map((n) => pluralForm(n, 'ru'))).toEqual([
      'one',
      'few',
      'many',
      'many',
      'one',
      'few',
    ]);
  });

  it('has two forms in English', () => {
    expect([0, 1, 2].map((n) => pluralForm(n, 'en'))).toEqual(['many', 'one', 'many']);
  });

  it('reads a category the keys do not name as "many"', () => {
    expect(pluralForm(2, 'ar')).toBe('many');
  });
});

describe('screenText', () => {
  it('passes a plain key through', () => {
    expect(screenText(translator({ title: 'Воркспейсы' }), 'ru')('title')).toBe('Воркспейсы');
  });

  it('counts with the form of the language in use', () => {
    const t = screenText(translator(ru), 'ru');
    expect([1, 2, 5, 21].map((n) => t.count('n', n))).toEqual([
      '1 воркспейс',
      '2 воркспейса',
      '5 воркспейсов',
      '21 воркспейс',
    ]);
  });

  it('reads "many" where a dictionary has no "few"', () => {
    const t = screenText(translator({ n_one: '{count} x', n_many: '{count} xs' }), 'ru');
    expect(t.count('n', 3)).toBe('3 xs');
  });

  it('fills the other parameters next to the count', () => {
    const t = screenText(translator({ r_one: '{from}–{to} of {count}', r_many: '{from}–{to} of {count}' }), 'en');
    expect(t.count('r', 40, { from: 1, to: 10 })).toBe('1–10 of 40');
  });
});
