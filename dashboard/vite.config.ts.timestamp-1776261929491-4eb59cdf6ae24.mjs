// vite.config.ts
import { defineConfig, loadEnv } from "file:///sessions/trusting-youthful-gauss/mnt/LLM-Portfolio-Dashboard/dashboard/node_modules/vite/dist/node/index.js";
import react from "file:///sessions/trusting-youthful-gauss/mnt/LLM-Portfolio-Dashboard/dashboard/node_modules/@vitejs/plugin-react-swc/index.js";
import path from "path";
var __vite_injected_original_dirname = "/sessions/trusting-youthful-gauss/mnt/LLM-Portfolio-Dashboard/dashboard";
var vite_config_default = defineConfig(({ mode }) => {
  const env = loadEnv(mode, __vite_injected_original_dirname, "");
  const explicitApiBaseUrl = env.NEXT_PUBLIC_API_BASE_URL?.trim() || env.VITE_API_BASE_URL?.trim();
  const dashboardBuildId = env.VITE_DASHBOARD_BUILD_ID?.trim() || process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "dev";
  return {
    envPrefix: ["VITE_", "NEXT_PUBLIC_"],
    define: {
      __DASHBOARD_BUILD_ID__: JSON.stringify(dashboardBuildId)
    },
    server: {
      host: "::",
      port: 8080,
      hmr: {
        overlay: false
      },
      proxy: explicitApiBaseUrl ? void 0 : {
        "/api": {
          target: "http://localhost:3001",
          changeOrigin: true
        }
      }
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__vite_injected_original_dirname, "./src")
      },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"]
    }
  };
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvc2Vzc2lvbnMvdHJ1c3RpbmcteW91dGhmdWwtZ2F1c3MvbW50L0xMTS1Qb3J0Zm9saW8tRGFzaGJvYXJkL2Rhc2hib2FyZFwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL3Nlc3Npb25zL3RydXN0aW5nLXlvdXRoZnVsLWdhdXNzL21udC9MTE0tUG9ydGZvbGlvLURhc2hib2FyZC9kYXNoYm9hcmQvdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL3Nlc3Npb25zL3RydXN0aW5nLXlvdXRoZnVsLWdhdXNzL21udC9MTE0tUG9ydGZvbGlvLURhc2hib2FyZC9kYXNoYm9hcmQvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcsIGxvYWRFbnYgfSBmcm9tIFwidml0ZVwiO1xuaW1wb3J0IHJlYWN0IGZyb20gXCJAdml0ZWpzL3BsdWdpbi1yZWFjdC1zd2NcIjtcbmltcG9ydCBwYXRoIGZyb20gXCJwYXRoXCI7XG5cbi8vIGh0dHBzOi8vdml0ZWpzLmRldi9jb25maWcvXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoKHsgbW9kZSB9KSA9PiB7XG4gIGNvbnN0IGVudiA9IGxvYWRFbnYobW9kZSwgX19kaXJuYW1lLCBcIlwiKTtcbiAgY29uc3QgZXhwbGljaXRBcGlCYXNlVXJsID1cbiAgICBlbnYuTkVYVF9QVUJMSUNfQVBJX0JBU0VfVVJMPy50cmltKCkgfHwgZW52LlZJVEVfQVBJX0JBU0VfVVJMPy50cmltKCk7XG5cbiAgY29uc3QgZGFzaGJvYXJkQnVpbGRJZCA9XG4gICAgZW52LlZJVEVfREFTSEJPQVJEX0JVSUxEX0lEPy50cmltKCkgfHxcbiAgICBwcm9jZXNzLmVudi5WRVJDRUxfR0lUX0NPTU1JVF9TSEE/LnNsaWNlKDAsIDcpIHx8XG4gICAgXCJkZXZcIjtcblxuICByZXR1cm4ge1xuICAgIGVudlByZWZpeDogW1wiVklURV9cIiwgXCJORVhUX1BVQkxJQ19cIl0sXG4gICAgZGVmaW5lOiB7XG4gICAgICBfX0RBU0hCT0FSRF9CVUlMRF9JRF9fOiBKU09OLnN0cmluZ2lmeShkYXNoYm9hcmRCdWlsZElkKSxcbiAgICB9LFxuICAgIHNlcnZlcjoge1xuICAgICAgaG9zdDogXCI6OlwiLFxuICAgICAgcG9ydDogODA4MCxcbiAgICAgIGhtcjoge1xuICAgICAgICBvdmVybGF5OiBmYWxzZSxcbiAgICAgIH0sXG4gICAgICBwcm94eTogZXhwbGljaXRBcGlCYXNlVXJsXG4gICAgICAgID8gdW5kZWZpbmVkXG4gICAgICAgIDoge1xuICAgICAgICAgICAgXCIvYXBpXCI6IHtcbiAgICAgICAgICAgICAgdGFyZ2V0OiBcImh0dHA6Ly9sb2NhbGhvc3Q6MzAwMVwiLFxuICAgICAgICAgICAgICBjaGFuZ2VPcmlnaW46IHRydWUsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIH0sXG4gICAgfSxcbiAgICBwbHVnaW5zOiBbcmVhY3QoKV0sXG4gICAgcmVzb2x2ZToge1xuICAgICAgYWxpYXM6IHtcbiAgICAgICAgXCJAXCI6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi9zcmNcIiksXG4gICAgICB9LFxuICAgICAgZGVkdXBlOiBbXCJyZWFjdFwiLCBcInJlYWN0LWRvbVwiLCBcInJlYWN0L2pzeC1ydW50aW1lXCIsIFwicmVhY3QvanN4LWRldi1ydW50aW1lXCIsIFwiQHRhbnN0YWNrL3JlYWN0LXF1ZXJ5XCIsIFwiQHRhbnN0YWNrL3F1ZXJ5LWNvcmVcIl0sXG4gICAgfSxcbiAgfTtcbn0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUF1WSxTQUFTLGNBQWMsZUFBZTtBQUM3YSxPQUFPLFdBQVc7QUFDbEIsT0FBTyxVQUFVO0FBRmpCLElBQU0sbUNBQW1DO0FBS3pDLElBQU8sc0JBQVEsYUFBYSxDQUFDLEVBQUUsS0FBSyxNQUFNO0FBQ3hDLFFBQU0sTUFBTSxRQUFRLE1BQU0sa0NBQVcsRUFBRTtBQUN2QyxRQUFNLHFCQUNKLElBQUksMEJBQTBCLEtBQUssS0FBSyxJQUFJLG1CQUFtQixLQUFLO0FBRXRFLFFBQU0sbUJBQ0osSUFBSSx5QkFBeUIsS0FBSyxLQUNsQyxRQUFRLElBQUksdUJBQXVCLE1BQU0sR0FBRyxDQUFDLEtBQzdDO0FBRUYsU0FBTztBQUFBLElBQ0wsV0FBVyxDQUFDLFNBQVMsY0FBYztBQUFBLElBQ25DLFFBQVE7QUFBQSxNQUNOLHdCQUF3QixLQUFLLFVBQVUsZ0JBQWdCO0FBQUEsSUFDekQ7QUFBQSxJQUNBLFFBQVE7QUFBQSxNQUNOLE1BQU07QUFBQSxNQUNOLE1BQU07QUFBQSxNQUNOLEtBQUs7QUFBQSxRQUNILFNBQVM7QUFBQSxNQUNYO0FBQUEsTUFDQSxPQUFPLHFCQUNILFNBQ0E7QUFBQSxRQUNFLFFBQVE7QUFBQSxVQUNOLFFBQVE7QUFBQSxVQUNSLGNBQWM7QUFBQSxRQUNoQjtBQUFBLE1BQ0Y7QUFBQSxJQUNOO0FBQUEsSUFDQSxTQUFTLENBQUMsTUFBTSxDQUFDO0FBQUEsSUFDakIsU0FBUztBQUFBLE1BQ1AsT0FBTztBQUFBLFFBQ0wsS0FBSyxLQUFLLFFBQVEsa0NBQVcsT0FBTztBQUFBLE1BQ3RDO0FBQUEsTUFDQSxRQUFRLENBQUMsU0FBUyxhQUFhLHFCQUFxQix5QkFBeUIseUJBQXlCLHNCQUFzQjtBQUFBLElBQzlIO0FBQUEsRUFDRjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
