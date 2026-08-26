import { describe, expect, it } from 'vitest';
import { Github, Plug } from 'lucide-react';
import { healthTone, iconFor } from './connection';

describe('provider glyphs', () => {
  it('draws a known provider with its own icon', () => {
    expect(iconFor('github')).toBe(Github);
  });

  it('falls back rather than failing on a provider newer than this screen', () => {
    expect(iconFor('perforce')).toBe(Plug);
  });
});

describe('health tone', () => {
  it('maps each state to the badge variant the design uses', () => {
    expect(healthTone('healthy')).toBe('success');
    expect(healthTone('unusable')).toBe('warning');
    expect(healthTone('checking')).toBe('muted');
  });
});
