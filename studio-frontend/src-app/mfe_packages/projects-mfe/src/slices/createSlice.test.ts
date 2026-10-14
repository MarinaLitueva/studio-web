import { describe, expect, it } from 'vitest';
import {
  CREATE_SLICE_KEY,
  chooseConnection,
  chooseProvider,
  clearProvider,
  createWizardSlice,
  pickSource,
  searchRepos,
  submitFailed,
} from './createSlice';

const reducer = createWizardSlice.reducer;

describe(`${CREATE_SLICE_KEY}: Back from the repositories`, () => {
  it('returns to the providers and keeps the picks', () => {
    let state = reducer(undefined, { type: '@@init' });
    state = reducer(state, chooseProvider('github'));
    state = reducer(state, chooseConnection('c-1'));
    state = reducer(state, searchRepos('api'));
    state = reducer(
      state,
      pickSource({ id: 'r-1', fullPath: 'acme/api', cloneUrl: 'https://github.com/acme/api.git', connectionId: 'c-1' })
    );

    state = reducer(state, clearProvider());

    expect(state).toMatchObject({ providerId: null, connectionId: null, search: '' });
    expect(state.draft.sources.map((pick) => pick.fullPath)).toEqual(['acme/api']);
  });

  it('drops the refusal, as the dialog does', () => {
    let state = reducer(undefined, { type: '@@init' });
    state = reducer(state, chooseProvider('github'));
    state = reducer(state, submitFailed({ kind: 'i18n', key: 'error_generic' }));

    state = reducer(state, clearProvider());

    expect(state.error).toBeNull();
  });
});
