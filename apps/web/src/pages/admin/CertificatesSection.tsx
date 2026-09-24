/**
 * Certificados num lugar só (Documento 4, seção 9.8).
 *
 * Antes daqui eram **duas** páginas e duas entradas de menu para o mesmo
 * assunto: `/admin/certificados/modelos` e `/admin/certificados/fila`. Quem
 * administra certificado ia numa para configurar o modelo e na outra para
 * aprovar o pedido, sem que uma dissesse que a outra existia — foi o que a G&G
 * apontou, olhando os Modelos e perguntando onde recebia o resto.
 *
 * **A permissão saiu da rota e veio para a aba, e isso é o ponto delicado.** As
 * duas telas tinham gates diferentes de propósito: modelo é documento da
 * empresa toda e o CRUD na API é `requireAdmin`, então a rota levava
 * `StrictAdminOnly`; a fila segue o escopo do curso, e por isso o SUBADMIN de
 * G&G entra nela, restrito ao próprio setor pelo service. Juntar as páginas sem
 * mover o gate faria uma das duas coisas erradas — trancar o subadmin fora da
 * fila que ele usa todo dia, ou mostrar a aba de modelos para quem a API vai
 * recusar na hora de salvar.
 *
 * A aba ativa vai na URL (`?aba=`), como em `PeopleAnalyticsSection`: é o que
 * deixa as rotas antigas redirecionarem para o lugar certo em vez de quebrar o
 * favorito de quem já usa a tela.
 */

import { useSearchParams } from 'react-router-dom'
import { isFullAdmin } from '@legends/shared'
import { Icon } from '../../components/Icon'
import { useAuth } from '../../auth/AuthContext'
import { CertificateRequestsSection } from './CertificateRequestsSection'
import { CertificateTemplatesSection } from './CertificateTemplatesSection'

type TabKey = 'fila' | 'modelos'

const TABS: { key: TabKey; label: string; icon: string; adminOnly: boolean }[] = [
  // A fila vem primeiro por ser a tela de trabalho: é a que tem pedido
  // esperando ação. Modelo se configura uma vez e se esquece.
  { key: 'fila', label: 'Fila de certificados', icon: 'pending_actions', adminOnly: false },
  { key: 'modelos', label: 'Modelos', icon: 'workspace_premium', adminOnly: true },
]

export function CertificatesSection() {
  const { user } = useAuth()
  const podeVerModelos = isFullAdmin(user)
  const abas = TABS.filter((aba) => !aba.adminOnly || podeVerModelos)

  const [searchParams, setSearchParams] = useSearchParams()
  const pedida = searchParams.get('aba')
  // Aba que a pessoa não pode ver cai na primeira disponível em vez de dar erro:
  // é o caso do subadmin que abre o link antigo de `/certificados/modelos`.
  const tab: TabKey = abas.some((aba) => aba.key === pedida) ? (pedida as TabKey) : abas[0].key

  function selectTab(key: TabKey) {
    const next = new URLSearchParams(searchParams)
    next.set('aba', key)
    setSearchParams(next, { replace: true })
  }

  return (
    <section className="flex flex-col gap-lg">
      <header>
        <h2 className="font-headline text-headline-lg text-on-surface">Certificados</h2>
        <p className="mt-2 text-body-md text-on-surface-variant">
          Os pedidos que chegam e os modelos usados para emitir — no mesmo lugar.
        </p>
      </header>

      {abas.length > 1 && (
        <div
          role="tablist"
          aria-label="Seções de certificados"
          className="flex flex-wrap gap-1 rounded-xl border border-outline-variant/40 bg-surface-container-low p-1"
        >
          {abas.map((item) => {
            const active = tab === item.key
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => selectTab(item.key)}
                className={[
                  'flex flex-1 items-center justify-center gap-xs rounded-lg px-md py-sm font-label text-label-md transition-colors',
                  active
                    ? 'bg-primary/10 font-bold text-primary'
                    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface',
                ].join(' ')}
              >
                <Icon name={item.icon} className="text-[18px]" />
                {item.label}
              </button>
            )
          })}
        </div>
      )}

      {tab === 'fila' ? <CertificateRequestsSection /> : <CertificateTemplatesSection />}
    </section>
  )
}
