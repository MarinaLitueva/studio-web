import React, { useEffect, useRef } from 'react';
import { useAppDispatch, useAppSelector, useSharedProperty } from '@gears-frontx/react';
import { STUDIO_SHARED_PROPERTY_CONTEXT_PROJECT, useHostChrome } from '@constructor-studio/mfe-shared';
import { ProjectListScreen } from './screens/project-list/ProjectListScreen';
import { ProjectScreen } from './screens/project/ProjectScreen';
import { NAV_SLICE_KEY, closeProject, openProject } from './slices/navSlice';
import styles from './ProjectsRoot.module.css';

/**
 * This MFE's screen-domain root. Not its only root any more: the New project
 * wizard is a second extension of the same MFE in the shell's overlay domain,
 * with its own bridge and its own shadow root (`NewProjectWizard`). The chrome
 * both of them need lives in `useHostChrome`; what stays here is the half that
 * is the screen's alone — the shell's project selection.
 *
 * Which screen shows is `projects/nav`, not a route — the shell has no router,
 * and ADR-0008 puts the project's own rail inside this frame.
 */
export const ProjectsRoot: React.FC = () => {
  const { containerRef, dataTheme } = useHostChrome();
  const dispatch = useAppDispatch();
  const projectId = useAppSelector((state) => state[NAV_SLICE_KEY].projectId);

  // Read inside the subscription without re-subscribing on every navigation.
  // Written in a deps-less effect, not during render: a discarded render
  // (StrictMode's double-invoke) would leave the ref ahead of what committed.
  const projectIdRef = useRef(projectId);
  useEffect(() => {
    projectIdRef.current = projectId;
  });

  const publishedProject = useSharedProperty(STUDIO_SHARED_PROPERTY_CONTEXT_PROJECT);

  useEffect(() => {
    const next = typeof publishedProject === 'string' && publishedProject ? publishedProject : null;
    if (next === projectIdRef.current) return;
    dispatch(next ? openProject(next) : closeProject());
  }, [publishedProject, dispatch]);

  return (
    <div ref={containerRef} className={styles.root} data-theme={dataTheme}>
      {projectId ? <ProjectScreen projectId={projectId} /> : <ProjectListScreen />}
    </div>
  );
};

ProjectsRoot.displayName = 'ProjectsRoot';
