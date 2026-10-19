/**
 * Where the user documentation lives (GitBook). Every dashboard's "User Documentation" link opens /documentation, which
 * forwards here, so the address is kept in one place. Set VITE_DOCUMENTATION_URL to point a deployment elsewhere.
 */
export const DOCUMENTATION_ROUTE = '/documentation';
export const DOCUMENTATION_URL: string = (import.meta.env.VITE_DOCUMENTATION_URL as string | undefined)?.trim() || 'https://helpdocumentation.gitbook.io/user';
