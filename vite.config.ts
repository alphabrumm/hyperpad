import { defineConfig } from 'vite'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

/**
 * Ergebnis: Ordner dist/ mit statischen Dateien, die auf jedem Webspace (HTTPS) laufen.
 * Kein Server-Backend nötig.
 */
export default defineConfig({
    base: './',
    define: {
        APP_VERSION: JSON.stringify(pkg.version),
    },
    build: {
        outDir: './dist',
        sourcemap: false,
        target: 'es2020',
        rollupOptions: {
            output: {
                manualChunks: (id: string) => {
                    if (id.includes('node_modules')) {
                        if (id.includes('@codemirror') || id.includes('@lezer') || id.includes('style-mod') || id.includes('crelt') || id.includes('w3c-keyname')) return 'codemirror';
                    }
                    return undefined;
                },
            }
        },
    },
    server: { host: true },
})
