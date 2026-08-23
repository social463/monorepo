import { CulturePageEditor } from './CulturePageEditor'
import { PersonalAssetsSection } from './PersonalAssetsSection'
import { VisualAssetsSection } from './VisualAssetsSection'

/**
 * Administração do Kit visual: as regras de uso (texto em Markdown), as peças
 * públicas e os materiais dirigidos a uma pessoa. Na mesma tela porque são o
 * mesmo assunto para quem publica.
 *
 * As peças e os materiais pessoais são coisas diferentes por baixo, e não só na
 * tela: peça mora em prefixo público do S3, material pessoal em prefixo privado
 * com link assinado. Ficam em painéis separados para que ninguém publique por
 * engano num campo o que era do outro.
 */
export function KitVisualSection() {
  return (
    <div className="flex flex-col gap-lg">
      <CulturePageEditor
        slug="kit-visual"
        panelTitle="Regras de uso da marca"
        hint="Texto opcional, exibido no topo da aba Kit visual, antes das peças. Serve para o que costuma dar errado: distorcer o logo, trocar a cor, aplicar sobre fundo sem contraste."
        savedMessage="Regras de uso salvas."
        errorMessage="Erro ao salvar as regras de uso."
        titlePlaceholder="Kit visual"
        subtitlePlaceholder="Como usar a marca"
        bodyPlaceholder={'## Como usar\n\n- Nunca distorça o logo\n- Respeite a área de proteção\n- Em fundo escuro, use a versão clara'}
      />
      <VisualAssetsSection />
      <PersonalAssetsSection />
    </div>
  )
}
