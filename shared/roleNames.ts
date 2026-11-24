/**
 * Display names of the management roles (docs/ROLE_AND_PERMISSION_MATRIX.md).
 *
 * The designations changed; the internal role keys did NOT:
 *   SUPER_ADMIN                                   -> "Managing Director"
 *   DEPARTMENT_HEAD with profiles.is_operations_head -> "CEO"   (formerly "Operations Head")
 * Database enum values, JWT claims, API parameters and every permission check keep their keys, so renaming grants nothing.
 *
 * Text written by the database and the server (error messages, notification titles and bodies, labels such as a leave stage) still uses the
 * internal wording: "Super Admin", "Operations Head", and "CEO" for the Super Admin (the "CEO meeting" features). That text is converted to
 * the new names exactly once, where it reaches a person, by {@link relabelRoles}: API errors (server/http/errors.ts), notifications in the
 * app and in pushes, and the database labels the screens show. Screens' own text is written with the new names directly.
 * Never run relabelRoles on text that already uses the new names (it would read the new "CEO" as the old one), nor on what a person wrote
 * (chat messages, notes, notices, customer data).
 */
export const ROLE_DISPLAY_NAMES = {
  SUPER_ADMIN: 'Managing Director',
  OPERATIONS_HEAD: 'CEO',
  DEPARTMENT_HEAD: 'Department Head',
  TEAM_HEAD: 'Team Lead',
  TEAM_MEMBER: 'Team Member'
} as const;

export const MANAGING_DIRECTOR = ROLE_DISPLAY_NAMES.SUPER_ADMIN;
export const CEO_TITLE = ROLE_DISPLAY_NAMES.OPERATIONS_HEAD;

// Longest phrases first; one pass, so a replacement is never replaced again.
const LEGACY_PHRASES: [string, string][] = [
  ['the CEO (Super Admin)', 'the Managing Director'],
  ['The CEO (Super Admin)', 'The Managing Director'],
  ['CEO (Super Admin)', 'Managing Director'],
  ['Super Admin (CEO)', 'Managing Director'],
  ['Super Admins', 'Managing Directors'],
  ['Super Admin', 'Managing Director'],
  ['super admins', 'managing directors'],
  ['super admin', 'managing director'],
  ['Super-Admin', 'Managing Director'],
  ['Superadmins', 'Managing Directors'],
  ['Superadmin', 'Managing Director'],
  ['Operations Heads', 'CEOs'],
  ['Operations Head', 'CEO'],
  ['Operation Heads', 'CEOs'],
  ['Operation Head', 'CEO'],
  ['operations heads', 'CEOs'],
  ['operations head', 'CEO'],
  // the internal "CEO" (the "CEO meeting" features) is the Super Admin
  ['CEOs', 'Managing Directors'],
  ['CEO', 'Managing Director']
];
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LEGACY_RE = new RegExp(`(?<![A-Za-z_])(?:${LEGACY_PHRASES.map(([from]) => escape(from)).join('|')})(?![A-Za-z_])`, 'g');
const LEGACY_MAP = new Map(LEGACY_PHRASES);

/** The internal role wording of system text (database / server) in the new designations. Null and undefined pass through. */
export function relabelRoles<T extends string | null | undefined>(text: T): T {
  if (!text) return text;
  return text.replace(LEGACY_RE, m => LEGACY_MAP.get(m) ?? m) as T;
}

/**
 * A stored designation shown with the new name. Exact matches only (the fixed values of the designation lists and the database's role
 * labels): a designation someone typed is shown as written.
 */
const DESIGNATION_RENAMES: Record<string, string> = {
  'Super Admin': 'Managing Director',
  'Operations Head': 'CEO',
  'Operation Head': 'CEO'
};
export function designationLabel<T extends string | null | undefined>(value: T): T {
  if (!value) return value;
  return (DESIGNATION_RENAMES[value.trim()] ?? value) as T;
}
