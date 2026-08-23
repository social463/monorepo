import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  clean: true,
  // empacota o pacote workspace (TS) no bundle final
  noExternal: ['@legends/shared'],
})
