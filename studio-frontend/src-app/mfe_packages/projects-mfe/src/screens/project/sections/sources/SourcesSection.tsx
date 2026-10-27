import React from 'react';
import { useEverLoaded } from '@constructor-studio/mfe-shared';
import { useSourcesSectionTranslations } from '../../../../i18n';
import { useSyncRefusals } from '../../../../shared/useSyncRefusals';
import { SourcesSkeleton, SourcesTable } from './SourcesTable';

interface SourcesSectionProps {
  projectId: string;
  orgId: string | null;
  workspaceId: string | null;
}

export const SourcesSection: React.FC<SourcesSectionProps> = ({ projectId, orgId, workspaceId }) => {
  const { isLoaded, error } = useSourcesSectionTranslations();
  const everLoaded = useEverLoaded(isLoaded);
  useSyncRefusals(projectId);

  if ((!everLoaded && !error) || orgId === null || workspaceId === null) {
    return <SourcesSkeleton />;
  }
  return <SourcesTable projectId={projectId} orgId={orgId} workspaceId={workspaceId} />;
};

SourcesSection.displayName = 'SourcesSection';
