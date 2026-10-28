import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import agents from "agents/vite";
import { defineConfig } from "vite";

process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = "true";
process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV = "true";

export default defineConfig({
  plugins: [
    agents(),
    react(),
    cloudflare({ remoteBindings: false }),
    tailwindcss(),
  ],
  server: {
    host: "0.0.0.0",
    port: 3000,
    allowedHosts: true,
  },
});
