import { CulturePageEditor } from './CulturePageEditor'

/**
 * Edição do manifesto. O editor em si é o genérico por slug — `CulturePage`
 * sempre foi assim no banco, e cada conteúdo novo é um slug, não uma tela nova.
 */
export function ManifestoSection() {
  return (
    <div className="flex flex-col gap-lg">
      <CulturePageEditor
        slug="manifesto"
        panelTitle="Manifesto cultural"
        savedMessage="Manifesto salvo."
        errorMessage="Erro ao salvar o manifesto."
        titlePlaceholder="Manifesto cultural"
        subtitlePlaceholder="EMR: Evoluir com Propósito"
        bodyPlaceholder={'## Por que existimos\n\nTexto do manifesto…\n\n- item de lista\n- **negrito** e *itálico*'}
      />
    </div>
  )
}
