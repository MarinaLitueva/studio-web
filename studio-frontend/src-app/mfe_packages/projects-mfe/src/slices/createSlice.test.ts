import { describe, expect, it } from 'vitest';
import {
  CREATE_SLICE_KEY,
  clearProvider,
  createWizardSlice,
  pickSource,
  searchRepositories,
  selectConnection,
  selectProvider,
} from './createSlice';

const reducer = createWizardSlice.reducer;

describe(`${CREATE_SLICE_KEY}: Back from the repositories`, () => {
  it('returns to the providers and keeps the picks', () => {
    let state = reducer(undefined, { type: '@@init' });
    state = reducer(state, selectProvider('github'));
    state = reducer(state, selectConnection('c-1'));
    state = reducer(state, searchRepositories('api'));
    state = reducer(
      state,
      pickSource({ id: 'r-1', fullPath: 'acme/api', cloneUrl: 'https://github.com/acme/api.git', connectionId: 'c-1' })
    );

    state = reducer(state, clearProvider());

    expect(state).toMatchObject({ providerId: null, connectionId: null, repoSearch: '' });
    expect(state.draft.sources.map((pick) => pick.fullPath)).toEqual(['acme/api']);
  });
});
