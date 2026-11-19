import { fileURLToPath } from "node:url";
import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { READER_API_PATH } from "./shared/constants/reader.constants.ts";

export default defineConfig({
  root: "ui",
  base: "./",
  plugins: [
    react(),
    tailwind(),
    viteSingleFile(),
    {
      name: "local-reader",
      async configureServer(server) {
        const { handleReaderRequest } = await import("./server/http/reader-api.ts");
        server.middlewares.use((req, res, next) => {
          if (req.url === READER_API_PATH) return handleReaderRequest(req, res);
          next();
        });
      },
    },
  ],
  server: { host: "127.0.0.1" },
  resolve: { alias: { "@": fileURLToPath(new URL("./ui/kit", import.meta.url)) } },
  build: {
    outDir: "../dist/hacker-news",
    emptyOutDir: false,
    reportCompressedSize: false,
    target: "es2022",
  },
});
