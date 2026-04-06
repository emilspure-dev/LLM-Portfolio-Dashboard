/// <reference types="vite/client" />

/** Injected by Vite (see vite.config.ts): git SHA on Vercel, or VITE_DASHBOARD_BUILD_ID, or "dev". */
declare const __DASHBOARD_BUILD_ID__: string;

interface ImportMetaEnv {
  readonly NEXT_PUBLIC_API_BASE_URL?: string;
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
