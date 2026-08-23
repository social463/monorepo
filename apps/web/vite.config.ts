import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3333',
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    // Teto de heap por worker. Um loop render→setState→render (identidade de
    // prop/estado nova a cada volta) não estoura como timeout — `testTimeout`
    // nunca dispara, porque o loop é de microtask/timer, não de espera. Sem
    // teto, o V8 vai até ~4 GB e o worker morre depois de MINUTOS, sem dizer
    // qual teste; com teto, morre em segundos com "heap out of memory".
    // 1 GB é folgado: os arquivos sadios aqui rodam em centenas de MB.
    pool: 'forks',
    poolOptions: { forks: { execArgv: ['--max-old-space-size=1024'] } },
    // Mostra o heap por arquivo — denuncia o arquivo que cresce antes de virar OOM.
    logHeapUsage: true,
  },
})
