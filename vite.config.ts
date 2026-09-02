import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig(({ mode }) => {
  if (mode === "demo") {
    return {
      plugins: [react()],
      build: { outDir: "demo-dist" },
    };
  }

  return {
    plugins: [
      react(),
      dts({
        include: [
          "src/index.ts",
          "src/FloydSteinberg.tsx",
          "src/BlueNoiseWave.tsx",
          "src/BlueNoiseFluid.tsx",
          "src/BlueNoiseLenia.tsx",
          "src/leniaPresets.ts",
          "src/shaders.ts",
        ],
      }),
    ],
    build: {
      lib: {
        entry: "src/index.ts",
        formats: ["es"],
        fileName: "index",
      },
      rollupOptions: {
        external: ["react", "react/jsx-runtime"],
      },
    },
  };
});
