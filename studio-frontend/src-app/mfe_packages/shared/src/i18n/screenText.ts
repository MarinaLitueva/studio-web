/**
 * `t('key')` bound to one namespace: a call site writes `t('title')` while
 * the registry is asked for `<namespace>:title`.
 */

import { useCallback } from 'react';
import { useTranslation } from '@gears-frontx/react';

export type ScreenText = (key: string, params?: Record<string, string | number | boolean>) => string;

export function createText(namespace: string): () => ScreenText {
  return function useScreenText(): ScreenText {
    const { t } = useTranslation();
    return useCallback<ScreenText>((key, params) => t(`${namespace}:${key}`, params), [t]);
  };
}
