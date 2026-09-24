/** Vídeo do tutorial no YouTube — o mesmo do site original da comunidade. */
const TUTORIAL_VIDEO_ID = 'T6mA7gGg6rY'

const IDEIA_PASSOS = [
  'Acesse a aba "Projetos" no menu',
  'Clique em "Criar projeto" e comece',
  'Preencha título, setor e categoria',
  'Descreva o problema que você quer resolver e sua proposta de solução',
  'Salve e dê o primeiro passo',
]

const EVOLUIR_PASSOS = [
  'Acesse seu projeto na lista',
  'Clique em "Editar / Atualizar"',
  'Registre avanços, ajustes e aprendizados',
  'Salve e continue construindo',
]

const DIARIO_PASSOS = ['Acesse o projeto desejado', 'Vá até a seção de diário', 'Adicione atualizações, evidências e links', 'Salve e compartilhe seu progresso']

const KANBAN_PASSOS = [
  'Acesse o projeto desejado',
  'Vá até a seção de tarefas (Kanban)',
  'Crie tarefas com título, responsável e prazo',
  'Mova as tarefas conforme o progresso',
  'Acompanhe o que está evoluindo e o que precisa de atenção',
]

const EVOLUCAO_BLOCOS = [
  {
    titulo: 'Evolução com propósito',
    texto:
      'Cada projeto avança por fases na esteira de inovação. Conforme evolui, os pontos e o status são atualizados, porque progresso se mede por impacto, não só por entrega.',
  },
  {
    titulo: 'Histórico que conta uma história',
    texto:
      'Mudanças de fase e registros do diário criam uma linha do tempo completa, documentando aprendizados e decisões ao longo do caminho.',
  },
  {
    titulo: 'Transparência para toda a organização',
    texto:
      'A liderança acompanha o progresso de cada área, garantindo reconhecimento e visibilidade para quem constrói com consistência.',
  },
]

const BOAS_PRATICAS = [
  { titulo: 'Atualize com constância', texto: 'Projetos que evoluem com frequência refletem execução real e comprometimento.' },
  { titulo: 'Registre o que aprendeu', texto: 'Cada aprendizado compartilhado fortalece toda a comunidade.' },
  { titulo: 'Documente com evidências', texto: 'Prints, vídeos e links transformam percepções em resultados concretos.' },
  { titulo: 'Seja claro e direto', texto: 'Linguagem simples garante que qualquer pessoa entenda e se inspire.' },
]

function ListaPassos({ titulo, passos, intro }: { titulo: string; passos: string[]; intro?: string }) {
  return (
    <section className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
      <h2 className="font-headline text-headline-sm text-on-surface">{titulo}</h2>
      {intro && <p className="mt-1 text-body-md text-on-surface-variant">{intro}</p>}
      <ol className="mt-md flex flex-col gap-sm">
        {passos.map((passo, index) => (
          <li key={passo} className="flex gap-sm text-body-md text-on-surface">
            <span className="font-label text-label-md text-primary">{index + 1}.</span>
            {passo}
          </li>
        ))}
      </ol>
    </section>
  )
}

export function InovaHowToPage() {
  return (
    <div className="flex flex-col gap-lg">
      <header>
        <h1 className="font-headline text-headline-lg text-on-surface">Como participar da transformação</h1>
        <p className="mt-1 text-body-md text-on-surface-variant">Um guia simples para você usar o site da Comunidade INOVA</p>
      </header>

      <section className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
        <h2 className="font-headline text-headline-sm text-on-surface">
          Como criar e editar projetos dentro do site INOVA EMR
        </h2>
        {/* youtube-nocookie: o player só grava cookie quando a pessoa dá play,
            e o domínio já está no frame-src da CSP do nginx. */}
        <div className="mt-md aspect-video overflow-hidden rounded-xl border border-outline-variant/40">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${TUTORIAL_VIDEO_ID}`}
            title="Tutorial INOVA EMR: como criar e editar projetos"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            loading="lazy"
            className="h-full w-full"
          />
        </div>
        <div className="mt-md flex flex-wrap gap-sm">
          <span className="inline-flex items-center gap-sm rounded-full border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant">
            Criar projeto
          </span>
          <span className="inline-flex items-center gap-sm rounded-full border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant">
            Gerenciar tarefas
          </span>
          <span className="inline-flex items-center gap-sm rounded-full border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant">
            Acompanhar evolução
          </span>
        </div>
      </section>

      <ListaPassos titulo="Como tirar sua ideia do papel" passos={IDEIA_PASSOS} />
      <ListaPassos titulo="Como evoluir seu projeto" passos={EVOLUIR_PASSOS} />
      <ListaPassos
        titulo="Registre sua jornada no diário"
        intro="O diário é o espaço para documentar a evolução do seu projeto, com textos, imagens e links. Cada registro conta a história do que você está construindo."
        passos={DIARIO_PASSOS}
      />
      <ListaPassos
        titulo="Organize a execução com o Kanban"
        intro="Cada projeto tem um quadro Kanban para organizar tarefas de forma visual, porque execução consistente é o que transforma ideias em resultados."
        passos={KANBAN_PASSOS}
      />

      <section className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
        <h2 className="font-headline text-headline-sm text-on-surface">Como acompanhamos a evolução</h2>
        <div className="mt-md grid grid-cols-1 gap-md md:grid-cols-3">
          {EVOLUCAO_BLOCOS.map((b) => (
            <div key={b.titulo}>
              <p className="font-label text-label-md text-on-surface">{b.titulo}</p>
              <p className="mt-1 text-body-sm text-on-surface-variant">{b.texto}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg">
        <h2 className="font-headline text-headline-sm text-on-surface">Boas práticas para gerar impacto</h2>
        <div className="mt-md grid grid-cols-1 gap-md md:grid-cols-2">
          {BOAS_PRATICAS.map((b) => (
            <div key={b.titulo}>
              <p className="font-label text-label-md text-on-surface">{b.titulo}</p>
              <p className="mt-1 text-body-sm text-on-surface-variant">{b.texto}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
