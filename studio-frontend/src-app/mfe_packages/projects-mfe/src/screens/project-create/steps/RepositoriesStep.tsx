/**
 * Step 2 — pick the repository a modernization starts from.
 */

// @cpt-dod:cpt-studiofrontend-dod-project-create-many-sources:p1
import React from 'react';
import { useAppDispatch, useAppSelector } from '@gears-frontx/react';
import { RepositoryPicker } from '../../../components/RepositoryPicker';
import {
  CREATE_SLICE_KEY,
  pickSource,
  searchRepositories,
  selectConnection,
  selectProvider,
} from '../../../slices/createSlice';
import { MAX_SOURCES } from '../../../model/projectDraft';

export const RepositoriesStep: React.FC = () => {
  const dispatch = useAppDispatch();
  const providerId = useAppSelector((state) => state[CREATE_SLICE_KEY].providerId);
  const connectionId = useAppSelector((state) => state[CREATE_SLICE_KEY].connectionId);
  const search = useAppSelector((state) => state[CREATE_SLICE_KEY].repoSearch);
  const sources = useAppSelector((state) => state[CREATE_SLICE_KEY].draft.sources);

  return (
    <RepositoryPicker
      providerId={providerId}
      onProviderChange={(provider) => dispatch(selectProvider(provider))}
      connectionId={connectionId}
      onConnectionChange={(id) => dispatch(selectConnection(id))}
      search={search}
      onSearchChange={(value) => dispatch(searchRepositories(value))}
      picks={sources}
      onToggle={(pick) => dispatch(pickSource(pick))}
      atCap={sources.length >= MAX_SOURCES}
    />
  );
};

RepositoriesStep.displayName = 'RepositoriesStep';
