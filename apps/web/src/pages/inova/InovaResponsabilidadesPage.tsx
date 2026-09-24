import { Icon } from '../../components/Icon'

const PAPEIS = [
  {
    titulo: 'Gente & Gestão (T&D)',
    icone: 'diversity_3',
    corBg: 'bg-secondary/10',
    corIcone: 'text-secondary',
    responsabilidades: [
      'Facilita a jornada, oferece apoio e acompanha cada projeto de perto.',
      'Conecta pessoas, remove dúvidas e garante que ninguém caminhe sozinho.',
    ],
  },
  {
    titulo: 'Líder',
    icone: 'shield_person',
    corBg: 'bg-tertiary/10',
    corIcone: 'text-tertiary',
    responsabilidades: [
      'Abre caminhos, remove barreiras e dá suporte contínuo ao time.',
      'Garante que os projetos tenham espaço, recursos e direção para avançar.',
      'Gerencia os recursos utilizados pela equipe no desenvolvimento dos projetos.',
    ],
  },
  {
    titulo: 'Responsáveis pelo Projeto',
    icone: 'rocket_launch',
    corBg: 'bg-primary/10',
    corIcone: 'text-primary',
    responsabilidades: [
      'Age como dono: executa, atualiza e evolui o projeto com autonomia.',
      'Aplica conceitos na prática, testa, itera e ajusta com agilidade.',
      'Propõe soluções com criatividade e método.',
      'Registra aprendizados e compartilha com a comunidade.',
      'Aproveita o processo e cresce com ele 💚',
    ],
  },
  {
    titulo: 'Representante de Projetos do Setor',
    icone: 'campaign',
    corBg: 'bg-surface-container-highest',
    corIcone: 'text-on-surface-variant',
    tooltip: 'Responsável por representar o setor nos Comitês de IA, garantindo visibilidade, alinhamento e acompanhamento dos projetos.',
    responsabilidades: [
      'Apresentar os projetos do setor no Comitê de IA.',
      'Consolidar informações sobre os projetos em andamento.',
      'Garantir alinhamento entre iniciativas do próprio setor e com outras áreas.',
      'Acompanhar o andamento dos projetos para reportar status com clareza.',
      'Identificar possíveis conexões ou sobreposição de iniciativas.',
      'Definido pelo líder do setor, deve ter visibilidade sobre todos os projetos da área.',
    ],
  },
]

/**
 * Papéis da Comunidade INOVA — conteúdo institucional estático, texto literal
 * do original (`ResponsabilidadesPage.tsx`). Aba própria do módulo, visível a
 * todo colaborador (sem gate de admin), igual ao item de nav do original.
 */
export function InovaResponsabilidadesPage() {
  return (
    <div className="flex flex-col gap-lg">
      <header>
        <h1 className="font-headline text-headline-lg text-on-surface">Responsabilidades</h1>
        <p className="mt-1 text-body-md text-on-surface-variant">
          Clareza de papéis para gerar impacto coletivo na Comunidade INOVA
        </p>
      </header>

      <div className="grid gap-md md:grid-cols-2 lg:grid-cols-4">
        {PAPEIS.map((papel) => (
          <div key={papel.titulo} className="rounded-2xl border border-outline-variant/40 bg-surface-container p-lg">
            <div className={`flex h-14 w-14 items-center justify-center rounded-full ${papel.corBg}`}>
              <Icon name={papel.icone} className={`text-[28px] ${papel.corIcone}`} />
            </div>
            <div className="mt-md flex items-center gap-xs">
              <h2 className="font-headline text-headline-sm text-on-surface">{papel.titulo}</h2>
              {papel.tooltip && (
                <span title={papel.tooltip}>
                  <Icon name="info" className="shrink-0 text-[16px] text-on-surface-variant" />
                </span>
              )}
            </div>
            <ul className="mt-md flex flex-col gap-sm">
              {papel.responsabilidades.map((r) => (
                <li key={r} className="flex items-start gap-xs text-body-sm text-on-surface-variant">
                  <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${papel.corIcone.replace('text-', 'bg-')}`} />
                  {r}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}
