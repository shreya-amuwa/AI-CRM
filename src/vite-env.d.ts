/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Address of the public careers site (separate from the CRM domain); the HR "Open public careers page" button shows only when set. */
  readonly VITE_CAREERS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
