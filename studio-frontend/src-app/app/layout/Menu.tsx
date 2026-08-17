/**
 * Menu Component
 *
 * Side navigation menu displaying MFE extensions with presentation metadata.
 * Uses local shadcn/ui Sidebar components for proper styling and collapsible behavior.
 *
 * Owns the signed-in identity and the sign-out control: the menu is the one
 * always-present chrome, so identity lives at its foot rather than in the
 * header, which belongs to the mounted screen.
 */

import React, { useCallback, useMemo } from 'react';
import {
  useFrontX,
  useAppDispatch,
  useAppSelector,
  useDomainExtensions,
  useMountedExtensions,
  eventBus,
  clearUser,
  FRONTX_ACTION_MOUNT_EXT,
  FRONTX_SCREEN_DOMAIN,
  type ScreenExtension,
  type MenuState,
  type HeaderState,
} from '@gears-frontx/react';
import {
  MFE_BOOTSTRAP_SLICE_KEY,
  type MfeBootstrapState,
} from '@/app/slices/mfeBootstrapSlice';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuIcon,
  SidebarMenuLabel,
  SidebarMenuSkeleton,
} from '@/app/components/ui/sidebar';
import { Avatar, AvatarImage, AvatarFallback } from '@/app/components/ui/avatar';
import { Skeleton } from '@/app/components/ui/skeleton';
import { Icon } from '@iconify/react';

export interface MenuProps {
  children?: React.ReactNode;
}

/**
 * The name an avatar resolves its colour and initials from. Falls back to the
 * email so a user without a display name still gets a stable colour rather than
 * the uncoloured state.
 */
function avatarNameOf(user: { displayName?: string; email?: string } | null | undefined): string {
  return user?.displayName?.trim() || user?.email || '';
}

export const Menu: React.FC<MenuProps> = ({ children }) => {
  const app = useFrontX();
  const { mfeRegistry, auth } = app;
  const dispatch = useAppDispatch();

  // Collapsed state lives in the framework's `layout/menu` slice, so anything
  // in the app (or an MFE) can collapse the menu by emitting the same event.
  const collapsed = useAppSelector(
    (state) => (state['layout/menu'] as MenuState | undefined)?.collapsed ?? false
  );
  const bootstrapStatus = useAppSelector(
    (state) => (state[MFE_BOOTSTRAP_SLICE_KEY] as MfeBootstrapState | undefined)?.status ?? 'pending'
  );
  const headerState = useAppSelector((state) => state['layout/header'] as HeaderState | undefined);
  const user = headerState?.user;
  const userLoading = headerState?.loading ?? false;

  // Currently-mounted screen extension (subscribes to store changes; no polling).
  // Index 0 is meaningful because the host registers the screen domain with
  // ExclusiveMountStrategy in `bootstrap.ts` (single mount per domain).
  const mountedScreens = useMountedExtensions(FRONTX_SCREEN_DOMAIN);
  const mountedId = mountedScreens[0]?.id;

  // Subscribed, not polled. This used to re-read the registry on a 500 ms
  // interval, which added up to half a second of blank menu after registration
  // finished. `useDomainExtensions` reads the same registry but re-renders on
  // store changes — and the store does change once bootstrap flips its status,
  // which happens after every extension is registered.
  const registered = useDomainExtensions(FRONTX_SCREEN_DOMAIN) as ScreenExtension[];
  const extensions = useMemo(
    () =>
      [...registered].sort(
        (a, b) => (a.presentation.order ?? 999) - (b.presentation.order ?? 999)
      ),
    [registered]
  );

  const handleMenuItemClick = useCallback(
    async (extensionId: string) => {
      if (!mfeRegistry) return;
      await mfeRegistry.executeActionsChain({
        action: {
          type: FRONTX_ACTION_MOUNT_EXT,
          target: FRONTX_SCREEN_DOMAIN,
          payload: { subject: extensionId },
        },
      });
    },
    [mfeRegistry]
  );

  const toggleCollapsed = useCallback(() => {
    eventBus.emit('layout/menu/collapsed', { collapsed: !collapsed });
  }, [collapsed]);

  const signOut = useCallback(async () => {
    dispatch(clearUser());
    // RP-initiated logout redirects to the IdP; static-token sessions end
    // locally and the AuthGate flips to the login screen via subscribe().
    const transition = await auth?.logout();
    if (transition?.type === 'redirect') window.location.href = transition.redirectUrl;
  }, [auth, dispatch]);

  return (
    <Sidebar collapsed={collapsed}>
      {/* Brand: full product name when expanded, short mark when collapsed.
          No onClick — the collapse control is its own row at the foot. */}
      <SidebarHeader
        collapsed={collapsed}
        logo={
          collapsed ? (
            <span className="text-heading-1 font-semibold text-foreground">CS</span>
          ) : undefined
        }
        logoText={
          collapsed ? undefined : (
            <span className="whitespace-nowrap text-heading-1 font-semibold text-foreground">
              Constructor Studio
            </span>
          )
        }
      />

      {/* Menu items */}
      <SidebarContent>
        <SidebarMenu>
          {extensions.length === 0 ? (
            // While the manifest is in flight the screen list is not empty —
            // it is unknown. Showing the "no screens" hint here is what made the
            // menu flash a paragraph of text and then replace it with items.
            bootstrapStatus === 'pending' ? (
              <SidebarMenuSkeleton collapsed={collapsed} />
            ) : collapsed ? null : (
              <div className="px-3 py-4 text-label text-muted-foreground">
                {bootstrapStatus === 'failed'
                  ? 'Screens could not be loaded. Check the console for the manifest error.'
                  : 'No screens yet. Add an MFE package by copying the _blank-mfe reference scaffold in mfe_packages/.'}
              </div>
            )
          ) : (
            extensions.map((ext) => {
              const isActive = ext.id === mountedId;
              const pres = ext.presentation;
              return (
                <SidebarMenuItem key={ext.id}>
                  <SidebarMenuButton
                    isActive={isActive}
                    onClick={() => handleMenuItemClick(ext.id)}
                    tooltip={collapsed ? pres.label : undefined}
                  >
                    {pres.icon && (
                      <SidebarMenuIcon>
                        {/* Size comes from SidebarMenuIcon's box (18px). */}
                        <Icon icon={pres.icon} />
                      </SidebarMenuIcon>
                    )}
                    {!collapsed && <span>{pres.label}</span>}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })
          )}
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter>
        {/* Identity. Sign-out is an icon on the row and hides with the labels;
            collapsed, the avatar alone stands for the session. */}
        {userLoading ? (
          <div className="flex items-center gap-2 p-2">
            <Skeleton className="h-8 w-8 rounded-full" />
            {!collapsed && <Skeleton className="h-4 w-28" />}
          </div>
        ) : (
          <div className="flex items-center gap-2 p-2">
            <Avatar className="h-8 w-8">
              {user?.avatarUrl && (
                <AvatarImage src={user.avatarUrl} alt={user?.displayName || user?.email || 'User'} />
              )}
              <AvatarFallback name={avatarNameOf(user)} />
            </Avatar>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">
                  {user?.displayName || user?.email || 'User'}
                </div>
                {user?.displayName && user?.email && (
                  <div className="truncate text-xs text-mainMenu-foreground">{user.email}</div>
                )}
              </div>
            )}
            {!collapsed && (
              <button
                type="button"
                aria-label="Sign out"
                title="Sign out"
                onClick={() => void signOut()}
                className="rounded-lg p-1.5 text-mainMenu-foreground transition-colors hover:bg-mainMenu-hover/65 hover:text-mainMenu-active-foreground"
              >
                <Icon icon="lucide:log-out" className="h-4 w-4" />
              </button>
            )}
          </div>
        )}

        {/* Collapse toggle */}
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              // Label role (13/16): the toggle is chrome for the menu, not one
              // of its destinations, so it sits a step below the items.
              textRole="label"
              aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
              tooltip={collapsed ? 'Expand menu' : undefined}
              onClick={toggleCollapsed}
            >
              <SidebarMenuIcon>
                <Icon icon={collapsed ? 'lucide:chevron-right' : 'lucide:chevron-left'} />
              </SidebarMenuIcon>
              {!collapsed && <SidebarMenuLabel>Collapse</SidebarMenuLabel>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      {children}
    </Sidebar>
  );
};

Menu.displayName = 'Menu';
