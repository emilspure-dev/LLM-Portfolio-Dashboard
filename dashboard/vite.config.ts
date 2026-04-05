import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "");
  const explicitApiBaseUrl =
    env.NEXT_PUBLIC_API_BASE_URL?.trim() || env.VITE_API_BASE_URL?.trim();

  return {
    envPrefix: ["VITE_", "NEXT_PUBLIC_"],
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false,
      },
      proxy: explicitApiBaseUrl
        ? undefined
        : {
            "/api": {
              target: "http://localhost:3001",
              changeOrigin: true,
            },
          },
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
    },
  };
});
