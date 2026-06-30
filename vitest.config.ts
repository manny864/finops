import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
    plugins: [react()],
    test: {
        environment: "jsdom",
        globals: true,
        setupFiles: ["./vitest.setup.ts"],
        css: false,
        include: ["__tests__/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
        exclude: ["**/node_modules/**", "**/.next/**", "__tests__/e2e/**"],
        coverage: {
            provider: "v8",
            reporter: ["text", "json-summary", "html"],
            include: ["src/lib/**", "src/services/**", "src/components/**"],
            exclude: [
                "src/**/*.test.{ts,tsx}",
                "src/**/*.d.ts",
                "src/lib/templates/**",
                "src/lib/mockData.ts",
            ],
        },
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
});
