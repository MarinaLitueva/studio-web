import React, { useEffect, useRef, useState } from 'react';
import type { ChildMfeBridge } from '@gears-frontx/react';
import {
  FRONTX_SHARED_PROPERTY_THEME,
  FRONTX_SHARED_PROPERTY_LANGUAGE,
  SUPPORTED_LANGUAGES,
  useAppDispatch,
  useAppSelector,
  useFrontX,
  type Language,
} from '@gears-frontx/react';
import { BridgeProvider } from './shared/bridge';
import { ProjectListScreen } from './screens/project-list/ProjectListScreen';
import { ProjectScreen } from './screens/project/ProjectScreen';
import { NAV_SLICE_KEY, closeProject, openProject } from './slices/navSlice';
import styles from './ProjectsRoot.module.css';

const RTL_LANGUAGES = ['ar', 'he', 'fa', 'ur'];

/** Restated, not imported: the shell's modules are behind the realm boundary. */
const STUDIO_SHARED_PROPERTY_CONTEXT_PROJECT =
  'gts.frontx.mfes.comm.shared_property.v1~constructor_studio.context.project.selected.v1~';

/**
 * A host theme is a full palette, not a light/dark bit, so it bridges to the
 * kit's two scopes by explicit enumeration. `dracula` therefore lands in the
 * kit's dark greys, not Dracula's purples — a stated residual limitation.
 * The screen root always carries data-theme so the kit's
 * prefers-color-scheme fallback cannot leak through.
 */
const DARK_HOST_THEMES = ['dark', 'dracula', 'dracula-large'];

function toKitTheme(hostTheme: string): 'dark' | 'light' {
  return DARK_HOST_THEMES.includes(hostTheme) ? 'dark' : 'light';
}

function readBridgeProperty(bridge: ChildMfeBridge, property: string, fallback: string): string {
  const current = bridge.getProperty(property);
  return current && typeof current.value === 'string' ? current.value : fallback;
}

interface ProjectsRootProps {
  bridge: ChildMfeBridge;
}

/**
 * The one mounted root of this MFE: it owns the bridge plumbing (theme,
 * language, text direction) and nothing else. Which screen shows is
 * `projects/nav`, not a route — the shell has no router, and ADR-0008 puts the
 * project's own rail inside this frame.
 */
export const ProjectsRoot: React.FC<ProjectsRootProps> = ({ bridge }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  // Initial value read directly from the bridge's lazy useState initializer (runs once,
  // synchronously, during the first render) instead of via setState in a mount effect.
  const [theme, setTheme] = useState<string>(() =>
    readBridgeProperty(bridge, FRONTX_SHARED_PROPERTY_THEME, 'default')
  );
  const [language, setLanguage] = useState<string>(() =>
    readBridgeProperty(bridge, FRONTX_SHARED_PROPERTY_LANGUAGE, 'en')
  );
  // If the host swaps the bridge instance, re-read its current properties during
  // render ("adjusting state during render") — the subscription below only
  // delivers future changes.
  const [prevBridge, setPrevBridge] = useState(bridge);
  if (prevBridge !== bridge) {
    setPrevBridge(bridge);
    setTheme(readBridgeProperty(bridge, FRONTX_SHARED_PROPERTY_THEME, 'default'));
    setLanguage(readBridgeProperty(bridge, FRONTX_SHARED_PROPERTY_LANGUAGE, 'en'));
  }

  const app = useFrontX();
  const dispatch = useAppDispatch();
  const projectId = useAppSelector((state) => state[NAV_SLICE_KEY].projectId);

  // Read inside the subscription without re-subscribing on every navigation.
  // Written in a deps-less effect, not during render: a discarded render
  // (StrictMode's double-invoke) would leave the ref ahead of what committed.
  const projectIdRef = useRef(projectId);
  useEffect(() => {
    projectIdRef.current = projectId;
  });

  /**
   * The shell's selection, applied to this MFE's own navigation — the half
   * ADR-0008 left out. The top bar's switcher clicks are `app/context/*` events
   * on the SHELL's eventBus, inaudible here; this property is what crosses.
   *
   * Two things the mechanism does NOT do, both load-bearing: it never fires on
   * subscribe, so the current value is read separately (which doubles as the
   * bridge-swap path), and it does not dedupe. Since the shell echoes back the
   * opens this MFE started, an unguarded apply would re-dispatch `openProject`
   * and reset the section to `overview` — clicking Team would bounce back.
   */
  useEffect(() => {
    const apply = (raw: unknown): void => {
      const next = typeof raw === 'string' && raw ? raw : null;
      if (next === projectIdRef.current) return;
      dispatch(next ? openProject(next) : closeProject());
    };

    apply(bridge.getProperty(STUDIO_SHARED_PROPERTY_CONTEXT_PROJECT)?.value);
    return bridge.subscribeToProperty(STUDIO_SHARED_PROPERTY_CONTEXT_PROJECT, (property) =>
      apply(property.value)
    );
  }, [bridge, dispatch]);

  useEffect(() => {
    const themeUnsubscribe = bridge.subscribeToProperty(
      FRONTX_SHARED_PROPERTY_THEME,
      (property) => {
        if (typeof property.value === 'string') setTheme(property.value);
      }
    );

    const languageUnsubscribe = bridge.subscribeToProperty(
      FRONTX_SHARED_PROPERTY_LANGUAGE,
      (property) => {
        if (typeof property.value === 'string') setLanguage(property.value);
      }
    );

    return () => {
      themeUnsubscribe();
      languageUnsubscribe();
    };
  }, [bridge]);

  // This realm has its OWN i18nRegistry (the host's is behind the module
  // boundary), and it is what `useFormatters()` reads for locale. Nothing feeds
  // it but us — without this, dates would always format as English.
  useEffect(() => {
    const supported = SUPPORTED_LANGUAGES.some((entry) => entry.code === language);
    if (supported) void app.i18nRegistry?.setLanguage(language as Language);
  }, [app, language]);

  // Keep the Shadow DOM host's text direction in sync with the active language.
  // An effect keyed by `language` also covers the initial language, which never
  // fires a callback.
  useEffect(() => {
    const rootNode = containerRef.current?.getRootNode();
    if (rootNode && 'host' in rootNode) {
      (rootNode.host as HTMLElement).dir = RTL_LANGUAGES.includes(language) ? 'rtl' : 'ltr';
    }
  }, [language]);

  return (
    <div ref={containerRef} className={styles.root} data-theme={toKitTheme(theme)}>
      <BridgeProvider bridge={bridge}>
        {projectId ? (
          <ProjectScreen bridge={bridge} projectId={projectId} />
        ) : (
          <ProjectListScreen />
        )}
      </BridgeProvider>
    </div>
  );
};

ProjectsRoot.displayName = 'ProjectsRoot';
