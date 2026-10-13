/**
 * Connect source's state: the picks, the search, the chosen connection and the write.
 */

// @cpt-dod:cpt-studiofrontend-dod-project-sources-picker:p1
import { createSlice, type ReducerPayload } from '@gears-frontx/react';
import type { Refusal } from '@constructor-studio/mfe-shared';
import { sourceKey, type RepositoryPick } from '../model/projectDraft';

export interface SourcesConnectState {
  picks: RepositoryPick[];
  providerId: string | null;
  connectionId: string | null;
  search: string;
  submitting: boolean;
  error: Refusal | null;
}

const SLICE_KEY = 'projects/sources-connect' as const;

const initialState: SourcesConnectState = {
  picks: [],
  providerId: null,
  connectionId: null,
  search: '',
  submitting: false,
  error: null,
};

const {
  slice,
  resetConnect,
  togglePick,
  chooseProvider,
  clearProvider,
  chooseConnection,
  searchRepos,
  connectStarted,
  connectFailed,
} = createSlice({
  name: SLICE_KEY,
  initialState,
  reducers: {
    resetConnect: () => initialState,
    // The ceiling counts the project's sources too, which only the dialog
    // reads, so the dialog makes the rows inert rather than this refusing.
    togglePick: (state: SourcesConnectState, action: ReducerPayload<RepositoryPick>) => {
      const key = sourceKey(action.payload);
      const kept = state.picks.filter((pick) => sourceKey(pick) !== key);
      state.picks = kept.length === state.picks.length ? [...kept, action.payload] : kept;
      state.error = null;
    },
    chooseProvider: (state: SourcesConnectState, action: ReducerPayload<string>) => {
      if (state.providerId === action.payload) return;
      state.providerId = action.payload;
      state.connectionId = null;
      state.search = '';
    },
    /** Back from the repositories to the providers; the picks stay. */
    clearProvider: (state: SourcesConnectState) => {
      state.providerId = null;
      state.connectionId = null;
      state.search = '';
      state.error = null;
    },
    chooseConnection: (state: SourcesConnectState, action: ReducerPayload<string>) => {
      if (state.connectionId === action.payload) return;
      state.connectionId = action.payload;
      state.search = '';
    },
    searchRepos: (state: SourcesConnectState, action: ReducerPayload<string>) => {
      state.search = action.payload;
    },
    connectStarted: (state: SourcesConnectState) => {
      state.submitting = true;
      state.error = null;
    },
    connectFailed: (state: SourcesConnectState, action: ReducerPayload<Refusal>) => {
      state.submitting = false;
      state.error = action.payload;
    },
  },
});

export const sourcesConnectSlice = slice;
export {
  resetConnect,
  togglePick,
  chooseProvider,
  clearProvider,
  chooseConnection,
  searchRepos,
  connectStarted,
  connectFailed,
};
export const SOURCES_CONNECT_SLICE_KEY = SLICE_KEY;

declare module '@gears-frontx/react' {
  interface RootState {
    'projects/sources-connect': SourcesConnectState;
  }
}

export default slice.reducer;
