/**
 * The vocabulary of a connection as this screen shows it.
 */

// @cpt-dod:cpt-studiofrontend-dod-connection-list-glyph:p1
import { Bot, GitBranch, Github, Gitlab, Plug, Sparkles, type LucideIcon } from 'lucide-react';

export type ProviderCode = 'github' | 'gitlab' | 'bitbucket' | 'anthropic' | 'openai';

/** The single place that knows which provider looks like what. */
const ICONS = {
  github: Github,
  gitlab: Gitlab,
  // lucide has no Bitbucket mark; a repository glyph is the honest stand-in.
  bitbucket: GitBranch,
  anthropic: Sparkles,
  openai: Bot,
} satisfies Record<ProviderCode, LucideIcon>;


export function iconFor(code: string): LucideIcon {
  return (ICONS as Record<string, LucideIcon>)[code] ?? Plug;
}

/** Every connection this screen creates is inherited by the whole organization. */
export const CONNECTION_SCOPE = 'organization';

export type ConnectionHealth = 'healthy' | 'unusable';

export function healthTone(health: ConnectionHealth): 'success' | 'warning' {
  return health === 'healthy' ? 'success' : 'warning';
}
