import type { PathId } from '../content/types'
import { paths } from '../content/library'
import { cx } from '../lib/cx'

// O repo não tem tokens `approved`/`warn` — a paleta Material 3 injetada por
// empresa (ver `packages/shared/src/branding.ts`, `BRAND_COLOR_TOKENS`) só
// define `primary`/`secondary`/`tertiary`/`error` (+ superfícies). `error` é o
// laranja "Residente Orange" do brandbook (a semântica de "warn"), `tertiary`
// é o azul complementar — `secondary` é um acento decorativo ("Residente
// Lime"), sem relação com aviso/erro.
const pathTone: Record<PathId, string> = {
  ia: 'border-primary/50 bg-primary-container text-on-primary-container',
  'ia-pessoa': 'border-tertiary/50 bg-tertiary-container text-on-tertiary-container',
  pessoa: 'border-error/50 bg-error-container text-on-error-container',
}

export function PathBadge({ path }: { path: PathId }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-xs rounded-full border px-md py-xs font-label text-label-sm font-bold',
        pathTone[path],
      )}
    >
      {paths[path].label}
    </span>
  )
}
