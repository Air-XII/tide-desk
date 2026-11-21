import { defineConfig } from "vite";

// Tauri 期望固定端口，端口被占用时直接失败而不是自动换端口
export default defineConfig({
  clearScreen: false,
  server: {
    port: 5273,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "chrome110",
    sourcemap: false,
  },
});
