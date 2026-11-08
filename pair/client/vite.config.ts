import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    server: {
      port: 13121,
      strictPort: true,
      allowedHosts: env.VITE_ALLOWED_HOST ? [env.VITE_ALLOWED_HOST] : undefined,
      // in dev the page and the signaling socket share one origin, like behind nginx in prod
      proxy: {
        '/ws': { target: `http://127.0.0.1:${env.PAIR_SIGNAL_PORT || 13119}`, ws: true },
      },
    },
    build: {
      rollupOptions: {
        output: {
          // the pdf.js worker ships as .mjs, which nginx serves as octet-stream (and browsers refuse
          // to run it as a module); as .js it gets a JavaScript type everywhere
          assetFileNames: (info: { names?: string[]; name?: string }) =>
            /\.mjs$/.test(info.names?.[0] ?? info.name ?? '') ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]',
        },
      },
    },
  }
})
