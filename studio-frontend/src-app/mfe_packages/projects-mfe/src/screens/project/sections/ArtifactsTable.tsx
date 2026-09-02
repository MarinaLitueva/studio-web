import React from 'react';
import {
  Button,
  Pagination,
  PaginationContent,
  PaginationItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@gears-frontx/ui-kit';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { sortByUpdated, type ArtifactRow, type UpdatedSort } from '../../../model/artifact';
import type { ArtifactColumn } from './artifactColumns';
import styles from './ArtifactsSection.module.css';

export interface ArtifactsTableLabels {
  table: string;
  emptyMessage: string;
  previous: string;
  next: string;
  range: (from: number, to: number, total: number) => string;
  page: (index: number) => string;
}

interface ArtifactsTableProps {
  rows: readonly ArtifactRow[];
  columns: readonly ArtifactColumn[];
  labels: ArtifactsTableLabels;
  resetKey: string;
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 15;
const MAX_PAGES_SHOWN = 7;

function pageWindow(current: number, count: number): number[] {
  if (count <= MAX_PAGES_SHOWN) return Array.from({ length: count }, (_, i) => i);
  const half = Math.floor(MAX_PAGES_SHOWN / 2);
  const start = Math.min(Math.max(0, current - half), count - MAX_PAGES_SHOWN);
  return Array.from({ length: MAX_PAGES_SHOWN }, (_, i) => start + i);
}

// @cpt-dod:cpt-studiofrontend-dod-project-artifacts-table:p1
export const ArtifactsTable: React.FC<ArtifactsTableProps> = ({
  rows,
  columns,
  labels,
  resetKey,
  pageSize = DEFAULT_PAGE_SIZE,
}) => {
  const [sort, setSort] = React.useState<UpdatedSort>('newest');
  const [page, setPage] = React.useState(0);

  const seenReset = React.useRef(resetKey);
  if (seenReset.current !== resetKey) {
    seenReset.current = resetKey;
    if (page !== 0) setPage(0);
  }

  const sorted = React.useMemo(() => sortByUpdated(rows, sort), [rows, sort]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pageCount - 1);
  const from = current * pageSize;
  const visible = sorted.slice(from, from + pageSize);

  const toggleSort = (): void => {
    setSort((previous) => (previous === 'newest' ? 'oldest' : 'newest'));
    setPage(0);
  };

  return (
    <>
      <Table label={labels.table} density="compact" className={styles.table}>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column.key} className={column.className}>
                {column.sortable ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={styles.sortButton}
                    onClick={toggleSort}
                  >
                    {column.label}
                    {sort === 'oldest' ? (
                      <ArrowUp size={14} strokeWidth={1.5} />
                    ) : (
                      <ArrowDown size={14} strokeWidth={1.5} />
                    )}
                  </Button>
                ) : (
                  column.label
                )}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.length === 0 ? (
            <TableRow>
              <TableCell colSpan={columns.length} className={styles.emptyCell}>
                {labels.emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            visible.map((row) => (
              <TableRow key={row.id}>
                {columns.map((column) => (
                  <TableCell key={column.key} className={column.className}>
                    {column.render(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <div className={styles.footer}>
        <span className={styles.range}>
          {labels.range(sorted.length === 0 ? 0 : from + 1, from + visible.length, sorted.length)}
        </span>
        <Pagination className={styles.pagination}>
          <PaginationContent>
            <PaginationItem>
              <Button
                variant="ghost"
                size="sm"
                className={styles.pageStep}
                aria-label={labels.previous}
                disabled={current === 0}
                onClick={() => setPage(current - 1)}
                icon={<ChevronLeft size={16} strokeWidth={1.5} />}
              />
            </PaginationItem>
            {pageWindow(current, pageCount).map((index) => (
              <PaginationItem key={index}>
                <Button
                  variant={index === current ? 'secondary' : 'ghost'}
                  size="sm"
                  className={styles.pageNumber}
                  aria-label={labels.page(index + 1)}
                  aria-current={index === current ? 'page' : undefined}
                  onClick={() => setPage(index)}
                >
                  {index + 1}
                </Button>
              </PaginationItem>
            ))}
            <PaginationItem>
              <Button
                variant="ghost"
                size="sm"
                className={styles.pageStep}
                aria-label={labels.next}
                disabled={current >= pageCount - 1}
                onClick={() => setPage(current + 1)}
                icon={<ChevronRight size={16} strokeWidth={1.5} />}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    </>
  );
};

ArtifactsTable.displayName = 'ArtifactsTable';
