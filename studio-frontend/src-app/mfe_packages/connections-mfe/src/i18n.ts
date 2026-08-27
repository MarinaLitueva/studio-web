/**
 * This MFE's translations, on the framework's own screen-level i18n. This
 * module adds the namespace: call sites write `t('title')` while the binding
 * asks the registry for `screen.connections.list:title`.
 */

import { useCallback } from 'react';
import {
  useScreenTranslations,
  useTranslation,
  type UseScreenTranslationsReturn,
} from '@gears-frontx/react';

const SCREENSET = 'connections';
const LIST_SCREEN = 'list';
const CONNECT_SCREEN = 'connect';

export const CONNECTION_LIST_NAMESPACE = `screen.${SCREENSET}.${LIST_SCREEN}`;
export const CONNECT_SOURCE_NAMESPACE = `screen.${SCREENSET}.${CONNECT_SCREEN}`;

type JsonModule = { default: Record<string, string> };
type ModuleMap = Record<string, () => Promise<JsonModule>>;

const listModules = import.meta.glob('./screens/connection-list/i18n/*.json') as ModuleMap;
const connectModules = import.meta.glob('./screens/connect-source/i18n/*.json') as ModuleMap;

/**
 * A language with no file resolves to an empty dictionary rather than to
 * English — `t()` then falls through to the registry's own English fallback,
 * one fallback instead of a second one open-coded here.
 */
function loadFrom(modules: ModuleMap, directory: string) {
  return async (language: string): Promise<Record<string, string>> => {
    const importer = modules[`${directory}/${language}.json`];
    if (!importer) return {};
    return (await importer()).default;
  };
}

const loadListTranslations = loadFrom(listModules, './screens/connection-list/i18n');
const loadConnectTranslations = loadFrom(connectModules, './screens/connect-source/i18n');

/** Loads the list screen's dictionary. One call, in `ConnectionListScreen`. */
export function useConnectionListScreenTranslations(): UseScreenTranslationsReturn {
  return useScreenTranslations(SCREENSET, LIST_SCREEN, loadListTranslations);
}

/**
 * Loads the Connect source form's dictionary. One call, in
 * `ConnectSourceDialog`. The form is a second mounted root with its own shadow
 * root, but `init.ts` builds the i18n registry once per entry — so this is the
 * same registry the screen uses, not a second one.
 */
export function useConnectSourceScreenTranslations(): UseScreenTranslationsReturn {
  return useScreenTranslations(SCREENSET, CONNECT_SCREEN, loadConnectTranslations);
}

export type ScreenText = (
  key: string,
  params?: Record<string, string | number | boolean>
) => string;

function createText(namespace: string): () => ScreenText {
  return function useScreenText(): ScreenText {
    const { t } = useTranslation();
    return useCallback<ScreenText>((key, params) => t(`${namespace}:${key}`, params), [t]);
  };
}

export const useConnectionListText = createText(CONNECTION_LIST_NAMESPACE);
export const useConnectSourceText = createText(CONNECT_SOURCE_NAMESPACE);
