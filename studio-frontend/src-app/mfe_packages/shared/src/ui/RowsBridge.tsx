import React, { useEffect, useRef } from 'react';
import { useDataGrid } from '@gears-frontx/ui-kit';

/** Where DataGrid's text-search plugin puts its value in `DataGridLoadContext.filters`, its default key. */
export const TEXT_SEARCH_FILTER_KEY = 'textSearch';

export const RowsBridge: React.FC<{ rowsKey: string }> = ({ rowsKey }) => {
  const grid = useDataGrid();
  const shown = useRef(rowsKey);
  useEffect(() => {
    if (shown.current === rowsKey) return;
    shown.current = rowsKey;
    void grid.triggerLoad();
  }, [grid, rowsKey]);
  return null;
};

RowsBridge.displayName = 'RowsBridge';
