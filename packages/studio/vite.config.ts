import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      input: {
        studio: resolve(__dirname, "index.html"),
        cockpit: resolve(__dirname, "cockpit/index.html"),
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    port: 4567,
    proxy: {
      "/api": {
        target: `http://localhost:${process.env.INKOS_STUDIO_PORT ?? "4569"}`,
        changeOrigin: true,
      },
    },
  },
});
