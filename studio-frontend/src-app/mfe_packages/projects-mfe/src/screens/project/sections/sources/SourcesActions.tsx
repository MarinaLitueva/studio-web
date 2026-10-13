// @cpt-dod:cpt-studiofrontend-dod-project-sources-connect-overlay:p1
import React from 'react';
import { Plug } from 'lucide-react';
import { useMfeBridge } from '@gears-frontx/react';
import { Button } from '@gears-frontx/ui-kit';
import { useEverLoaded } from '@constructor-studio/mfe-shared';
import { useSourcesSectionTranslations, useSourcesText } from '../../../../i18n';
import { openSourcesConnect } from '../../../../actions/sourcesConnectActions';

/** The Sources header's actions */
export const SourcesActions: React.FC = () => {
  const { isLoaded } = useSourcesSectionTranslations();
  const everLoaded = useEverLoaded(isLoaded);
  const t = useSourcesText();
  const bridge = useMfeBridge();

  if (!everLoaded) return null;
  return (
    <Button size="sm" icon={<Plug />} onClick={() => openSourcesConnect(bridge)}>
      {t('connect_source')}
    </Button>
  );
};

SourcesActions.displayName = 'SourcesActions';
