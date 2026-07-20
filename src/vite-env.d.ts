/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MOCK_DEFAULT: string;
  readonly VITE_AUTH_WEB_URL: string;
  readonly VITE_API_BASE: string;
  readonly VITE_APP_ID: string;
  readonly VITE_SIGNAL_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
