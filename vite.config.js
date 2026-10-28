import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Listen on all network interfaces so phones on the same Wi-Fi can open
    // the game via the PC's LAN IP (http://192.168.x.x:5173/).
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
  },
  preview: { host: "0.0.0.0", port: 5173, strictPort: true },
  build: {
    // Rapier embeds its WASM binary. Cache it separately from UI and renderer code.
    chunkSizeWarningLimit: 2500,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "physics",
              test: /node_modules[\\/]@dimforge[\\/]/,
              priority: 30,
            },
            {
              name: "three",
              test: /node_modules[\\/]three[\\/]/,
              priority: 20,
            },
            {
              name: "react",
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
});
