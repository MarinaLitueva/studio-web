/** The values of the Specs list's *Filter specs*, in the menu's order */

// @cpt-dod:cpt-studiofrontend-dod-project-specs-filter-state:p1
export type SpecsFilter =
  | 'all'
  | 'with_findings'
  | 'check_needed'
  | 'type_not_set'
  | 'type_to_confirm'
  | 'type_confirmed'
  | 'not_specifications';

export const SPECS_FILTERS: readonly SpecsFilter[] = [
  'all',
  'with_findings',
  'check_needed',
  'type_not_set',
  'type_to_confirm',
  'type_confirmed',
  'not_specifications',
];
