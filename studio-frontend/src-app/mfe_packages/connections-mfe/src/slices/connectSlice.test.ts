import { describe, expect, it } from 'vitest';
import { EMPTY_DRAFT } from '../model/connectionDraft';
import connectReducer, { editDraft, resetForm, submitFailed, submitStarted } from './connectSlice';

const FILLED = connectReducer(
  undefined,
  editDraft({ provider: 'github', label: 'GitHub', token: 'ghp_secret' })
);

describe('connect form state', () => {
  it('clears the credential on reset — the store outlives the overlay root', () => {
    expect(FILLED.draft.token).toBe('ghp_secret');
    expect(connectReducer(FILLED, resetForm()).draft).toEqual(EMPTY_DRAFT);
  });

  it('clears a previous refusal as soon as the member edits anything', () => {
    const refused = connectReducer(FILLED, submitFailed('bad credentials'));
    expect(refused.error).toBe('bad credentials');
    expect(connectReducer(refused, editDraft({ label: 'GitHub 2' })).error).toBeNull();
  });

  it('reports submission so the buttons can go inert', () => {
    const submitting = connectReducer(FILLED, submitStarted());
    expect(submitting.submitting).toBe(true);
    expect(connectReducer(submitting, submitFailed('nope')).submitting).toBe(false);
  });
});
