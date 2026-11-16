/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Address of the public careers site (separate from the CRM domain); the HR "Open public careers page" button shows only when set. */
  readonly VITE_CAREERS_URL?: string;
  /** Error reporting (Sentry project ai-crm-frontend, docs/ERROR_MONITORING.md): nothing is sent unless the DSN is set at build time. */
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SENTRY_ENVIRONMENT?: string;
  readonly VITE_SENTRY_RELEASE?: string;
  readonly VITE_SENTRY_TRACES_SAMPLE_RATE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
