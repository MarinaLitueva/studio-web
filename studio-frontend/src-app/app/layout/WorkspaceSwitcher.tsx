/** WorkspaceSwitcher Component */

// @cpt-dod:cpt-studiofrontend-dod-workspace-scope-slot:p1
import React, { useCallback } from 'react';
import { useAppSelector, eventBus } from '@gears-frontx/react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@gears-frontx/ui-kit/dropdown-menu';
import { ChevronDown, LayoutGrid } from 'lucide-react';
import {
  APP_CONTEXT_SLICE_KEY,
  type AppContextState,
  type ContextEntity,
} from '@/app/slices/appContextSlice';

export const WorkspaceSwitcher: React.FC = () => {
  const context = useAppSelector(
    (state) => state[APP_CONTEXT_SLICE_KEY] as AppContextState | undefined
  );

  const current: ContextEntity | null = context?.workspace ?? null;
  const options: ContextEntity[] = context?.workspaces ?? [];
  const used = context?.screenUsesWorkspace ?? false;

  const pick = useCallback((id: string) => {
    eventBus.emit('app/context/workspace/changed', { workspaceId: id });
  }, []);

  if (!used || !current) return null;

  const label = (
    <>
      <LayoutGrid className="size-5 shrink-0 text-muted-foreground" strokeWidth={1.3} />
      <span className="truncate text-[16px] font-semibold leading-6 text-foreground">
        {current.name}
      </span>
    </>
  );
  if (options.length < 2) {
    return <span className="flex h-9 min-w-0 items-center gap-2 px-2.5">{label}</span>;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-9 max-w-64 items-center gap-2 rounded-lg px-2.5 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
        {label}
        <ChevronDown
          className="size-[18px] shrink-0 text-muted-foreground"
          strokeWidth={1.3}
          aria-hidden="true"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={4} className="min-w-56 rounded-lg">
        {options.map((option) => (
          <DropdownMenuItem key={option.id} onClick={() => pick(option.id)}>
            {option.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

WorkspaceSwitcher.displayName = 'WorkspaceSwitcher';
