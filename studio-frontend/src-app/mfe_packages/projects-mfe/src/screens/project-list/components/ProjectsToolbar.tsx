import React from 'react';
import { Search } from 'lucide-react';
import { Button, Input, Skeleton } from '@gears-frontx/ui-kit';
import { useProjectListText } from '../../../i18n';
import { useMfeBridge } from '@gears-frontx/react';
import { openProjectWizard } from '../../../actions/wizardActions';
import styles from '../ProjectListScreen.module.css';

interface ProjectsToolbarProps {
  query: string;
  onQueryChange: (query: string) => void;
  busy: boolean;
}

/**
 * The mockup's Portfolio Header: the page title and every control that acts on
 * the list, on one line above the table.
 */
export const ProjectsToolbar: React.FC<ProjectsToolbarProps> = ({
  query,
  onQueryChange,
  busy,
}) => {
  const t = useProjectListText();
  const bridge = useMfeBridge();

  return (
  <div className={styles.toolbar} role="toolbar" aria-label={t('toolbar_label')}>
    <h1 className={styles.title}>
      {busy ? <Skeleton className={styles.titleSkeleton} /> : t('title')}
    </h1>

    <div className={styles.controls}>
      <Input
        className={styles.search}
        type="search"
        value={query}
        icon={<Search size={16} strokeWidth={1.3} />}
        placeholder={t('search_placeholder')}
        onChange={(event) => onQueryChange(event.target.value)}
        aria-label={t('search_placeholder')}
      />
      <Button size="sm" onClick={() => openProjectWizard(bridge)}>
        {t('new_project')}
      </Button>
    </div>
  </div>
  );
};

ProjectsToolbar.displayName = 'ProjectsToolbar';
