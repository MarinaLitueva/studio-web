import React from 'react';
import { ChevronRight, FileSpreadsheet, Folder } from 'lucide-react';
import {
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@gears-frontx/ui-kit';
import { useFormatters } from '@gears-frontx/react';
import { requestOpenProject } from '../../../actions/projectsActions';
import { useBridge } from '../../../shared/bridge';
import { isProject, isWorkspace } from '../../../model/project';
import { useProjectTree, type TreeRow } from '../../../shared/projectTree';
import { useProjectConfig } from '../../../shared/useProjectConfig';
import { useProjectListText } from '../../../i18n';
import { NoData } from './NoData';
import { OwnerInline } from './OwnerInline';
import { ProjectStatusInline, StatusInline } from './StatusInline';
import styles from '../ProjectListScreen.module.css';

/** Keep in step with the header below — the skeleton row spans them all. */
const COLUMN_COUNT = 6;

interface ProjectsTableProps {
  rows: readonly TreeRow[];
  onToggle: (tenantId: string) => void;
}

/*
 * TODO: the tree affordances below belong in the ui-kit, not here. `Chevron`,
 * `TenantGlyph` and the `--row-level` indentation add up to an expandable-row
 * Table — a kit capability its `Table` does not have yet — and keeping them local
 * means the next tree-shaped screen reimplements the indent step, the chevron
 * rotation and the disabled-leaf state from scratch. What stays projects-specific
 * is only which tenant types are leaves.
 */

/** A project is a leaf that opens; anything above it is a container. */
const TenantGlyph: React.FC<{ project: boolean }> = ({ project }) => (
  <span className={styles.rowGlyph} aria-hidden>
    {project ? (
      <FileSpreadsheet size={16} strokeWidth={1.3} />
    ) : (
      <Folder size={16} strokeWidth={1.3} />
    )}
  </span>
);

const Chevron: React.FC<{ expandable: boolean; expanded: boolean }> = ({
  expandable,
  expanded,
}) => (
  <span className={styles.chevron} data-expandable={expandable} data-expanded={expanded} aria-hidden>
    <ChevronRight size={12} strokeWidth={1.4} />
  </span>
);

/**
 * One row of the tree, drawn from the tenant page its parent fetched.
 */
const RowCells: React.FC<{
  row: TreeRow;
  onToggle: (tenantId: string) => void;
  status: React.ReactNode;
  owner: React.ReactNode;
}> = ({ row, onToggle, status, owner }) => {
  const t = useProjectListText();
  const { tenant, level, expandable, expanded } = row;
  const project = isProject(tenant);
  const { formatRelative } = useFormatters();
  const bridge = useBridge();
  const { siblingProjects } = useProjectTree();

  /** A project opens on click, a node with children toggles. */
  const activate = (): void => {
    if (project) {
      // The switcher's list while this project is open: its workspace's page.
      const siblings = siblingProjects(tenant.id).map((sibling) => ({
        id: sibling.id,
        name: sibling.name,
      }));
      requestOpenProject({ id: tenant.id, name: tenant.name }, siblings, bridge);
      return;
    }
    if (expandable) onToggle(tenant.id);
  };

  return (
    <TableRow>
      <TableCell className={styles.colProject}>
        <button
          type="button"
          className={styles.nameButton}
          style={{ '--row-level': level } as React.CSSProperties}
          disabled={!project && !expandable}
          aria-expanded={expandable ? expanded : undefined}
          onClick={activate}
        >
          <Chevron expandable={expandable} expanded={expanded} />
          <TenantGlyph project={project} />
          <span className={styles.nameText}>
            <span className={styles.name}>{tenant.name}</span>
            {isWorkspace(tenant) ? (
              <span className={styles.subtitle}>{t('workspace_row')}</span>
            ) : null}
          </span>
        </button>
      </TableCell>
      <TableCell className={styles.colStatus}>{status}</TableCell>
      <TableCell className={styles.colIssues}>
        {/* Findings/Signals have no portfolio rollup — see `issueSummary`. */}
        <NoData label={t('no_data')} />
      </TableCell>
      <TableCell className={styles.colMovement}>
        <NoData label={t('no_data')} />
      </TableCell>
      <TableCell className={styles.colOwner}>{owner}</TableCell>
      <TableCell className={styles.colUpdated}>
        <span className={styles.updated}>{formatRelative(tenant.updated_at)}</span>
      </TableCell>
    </TableRow>
  );
};

RowCells.displayName = 'RowCells';

/** The one place this screen reads a project's metadata. */
const ProjectRow: React.FC<{
  row: TreeRow;
  onToggle: (tenantId: string) => void;
}> = ({ row, onToggle }) => {
  const state = useProjectConfig(row.tenant.id);

  return (
    <RowCells
      row={row}
      onToggle={onToggle}
      status={<ProjectStatusInline tenant={row.tenant} state={state} />}
      owner={<OwnerInline state={state} />}
    />
  );
};

ProjectRow.displayName = 'ProjectRow';

const ContainerRow: React.FC<{
  row: TreeRow;
  onToggle: (tenantId: string) => void;
}> = ({ row, onToggle }) => {
  const t = useProjectListText();

  return (
    <RowCells
      row={row}
      onToggle={onToggle}
      status={<StatusInline tenant={row.tenant} />}
      owner={<NoData label={t('no_owner')} />}
    />
  );
};

ContainerRow.displayName = 'ContainerRow';

const Row: React.FC<{
  row: TreeRow;
  onToggle: (tenantId: string) => void;
}> = ({ row, onToggle }) =>
  isProject(row.tenant) ? (
    <ProjectRow row={row} onToggle={onToggle} />
  ) : (
    <ContainerRow row={row} onToggle={onToggle} />
  );

Row.displayName = 'Row';

const PendingRow: React.FC<{ level: number }> = ({ level }) => (
  <TableRow aria-hidden>
    <TableCell colSpan={COLUMN_COUNT}>
      <span
        className={styles.pending}
        style={{ '--row-level': level + 1 } as React.CSSProperties}
      >
        <Skeleton className={styles.pendingSkeleton} />
      </span>
    </TableCell>
  </TableRow>
);

/**
 * The mockup's Projects Portfolio table: Project, Status, Issues, 7-day
 * movement, Owner, Updated.
 */
export const ProjectsTable: React.FC<ProjectsTableProps> = ({ rows, onToggle }) => {
  const t = useProjectListText();

  return (
    <Table label={t('title')} className={styles.table}>
      <TableHeader>
        <TableRow>
          {/* Plain heads while the sort is out of the UI; `SortableHead` is the
              indicator-carrying variant, kept unmounted. */}
          <TableHead className={styles.colProject}>{t('col_project')}</TableHead>
          <TableHead className={styles.colStatus}>{t('col_status')}</TableHead>
          <TableHead className={styles.colIssues}>{t('col_issues')}</TableHead>
          <TableHead className={styles.colMovement}>{t('col_movement')}</TableHead>
          <TableHead className={styles.colOwner}>{t('col_owner')}</TableHead>
          <TableHead className={styles.colUpdated}>{t('col_updated')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <React.Fragment key={row.tenant.id}>
            <Row row={row} onToggle={onToggle} />
            {row.pending ? <PendingRow level={row.level} /> : null}
          </React.Fragment>
        ))}
      </TableBody>
    </Table>
  );
};

ProjectsTable.displayName = 'ProjectsTable';
