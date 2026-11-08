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
  }
})
