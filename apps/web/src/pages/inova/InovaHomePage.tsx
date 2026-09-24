import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { ImageLightbox, type LightboxImage } from '../../components/ImageLightbox'

const CULTURA_DIZ = [
  'Valorizamos colaboração',
  'Tomamos decisões com base em dados',
  'Buscamos excelência em cada entrega',
  'Incentivamos inovação contínua',
  'Esperamos autonomia e protagonismo das pessoas',
]

const INOVA_TRANSFORMA = [
  'Ideias viram melhorias reais',
  'Testamos soluções em pequena escala',
  'Compartilhamos aprendizados com o time',
  'Evoluímos com base em evidências',
  'Pessoas assumem protagonismo nas mudanças',
]

const COMITE_FLUXO = [
  { titulo: 'Times / Setores', texto: 'Iniciativas surgem dos times' },
  { titulo: 'Encontro de Alinhamento', texto: 'Compartilhamento entre áreas' },
  { titulo: 'Consolidação de insights', texto: 'Resumo das oportunidades' },
  { titulo: 'Comitê Executivo', texto: 'Avaliação e priorização' },
  { titulo: 'Decisões estratégicas', texto: 'Definição do que escalar' },
  { titulo: 'Direcionamento para os times', texto: 'Retorno às áreas com clareza' },
]

const ENCONTRO_ITENS = [
  'Representantes de cada área compartilham projetos',
  'Visibilidade do que está acontecendo na empresa',
  'Identificação de oportunidades de colaboração',
  'Redução de retrabalho entre times',
  'Geração de um resumo consolidado',
]

const COMITE_ITENS = [
  'Avaliação dos projetos levantados',
  'Priorização de iniciativas',
  'Direcionamento de investimentos',
  'Abertura de novas frentes',
]

const IMPACTOS = [
  { icone: 'bolt', label: 'Mais eficiência, menos retrabalho' },
  { icone: 'groups', label: 'Experiências que fazem diferença' },
  { icone: 'auto_awesome', label: 'Recursos bem aplicados' },
  { icone: 'rocket_launch', label: 'Novas formas de gerar valor' },
]

const JORNADA = [
  { numero: '01', icone: 'groups', titulo: 'Faça parte da Comunidade', texto: 'Conecte-se com outros protagonistas e comece sua jornada de transformação.' },
  { numero: '02', icone: 'psychology', titulo: 'Aprenda e colabore', texto: 'Troque experiências no Teams, aprenda com o time e fortaleça suas ideias.' },
  { numero: '03', icone: 'flag', titulo: 'Tire ideias do papel', texto: 'Desenvolva seu projeto com propósito, método e suporte contínuo da comunidade.' },
  { numero: '04', icone: 'co_present', titulo: 'Mostre seu impacto', texto: 'Apresente seus resultados no evento INOVA e inspire toda a organização.' },
]

// O `name` vira o alt da imagem no overlay, então leva a descrição, não o arquivo.
const MEMORIAS: LightboxImage[] = [
  { url: '/inova/inova-2025-linkedin.png', name: 'Ganhadores INOVA EMR 2025' },
  { url: '/inova/festival-inova.jpg', name: 'Festival INOVA EMR 2025' },
]

const sectionCard = 'relative rounded-2xl inova-glass-card p-lg md:p-xl'
const iconCircle = 'flex h-12 w-12 items-center justify-center rounded-full inova-gradient-green'

export function InovaHomePage() {
  // Índice da memória aberta no overlay. Antes cada foto abria em aba nova, e
  // quem só queria ver o banner de perto saía da comunidade para isso.
  const [memoriaAberta, setMemoriaAberta] = useState<number | null>(null)

  return (
    <div className="inova-theme flex flex-col gap-xl">
      {/* Hero */}
      <section className="relative flex flex-col items-center gap-md overflow-hidden py-md text-center">
        <div className="inova-blob -top-[120px] -left-[80px] h-[420px] w-[420px]" />
        <div className="inova-blob -bottom-[100px] -right-[80px] h-[360px] w-[360px]" />
        <img
          src="/inova/inova-emr-logo.png"
          alt="INOVA EMR"
          className="inova-logo-glow inova-fade-in relative w-[220px] md:w-[280px]"
        />
        <h1
          className="inova-fade-in relative max-w-2xl font-headline text-headline-xl text-on-surface"
          style={{ ['--inova-fade-delay' as string]: '0.1s' }}
        >
          Transformando ideias em <span className="inova-text-gradient">impacto real</span>
        </h1>
        <p
          className="inova-fade-in relative max-w-2xl text-body-lg text-on-surface-variant"
          style={{ ['--inova-fade-delay' as string]: '0.2s' }}
        >
          Aqui, cada projeto nasce com propósito e evolui para gerar transformação real. Usamos{' '}
          <strong className="text-on-surface">Inteligência Artificial</strong> como alavanca para inovar com método,
          colaboração e excelência.
        </p>
        <div
          className="inova-fade-in relative mt-sm flex flex-wrap items-center justify-center gap-md"
          style={{ ['--inova-fade-delay' as string]: '0.3s' }}
        >
          <Link
            to="/comunidade-inova/projetos"
            className="inova-gradient-green inova-glow-primary inline-flex items-center gap-sm rounded-full px-lg py-sm font-label text-label-md font-bold text-[#16321f] transition-transform hover:scale-[1.02]"
          >
            Explorar projetos da comunidade
            <Icon name="arrow_forward" className="text-[18px]" />
          </Link>
          <Link
            to="/comunidade-inova/novo"
            className="inline-flex items-center gap-sm rounded-full px-lg py-sm font-label text-label-md font-bold text-white shadow-lg transition-transform hover:scale-[1.02]"
            style={{ background: 'hsl(var(--inova-orange))' }}
          >
            Tirar minha ideia do papel
          </Link>
        </div>
      </section>

      {/* Cultura */}
      <section className={sectionCard}>
        <div className="absolute inset-x-0 top-0 inova-glow-line" />
        <p className="font-label text-label-md uppercase tracking-[0.2em] text-primary">Cultura</p>
        <h2 className="mt-2 font-headline text-headline-lg text-on-surface">
          O que o INOVA tem a ver com a nossa cultura?
        </h2>
        <p className="mt-1 text-body-md text-on-surface-variant">
          O INOVA é onde nossa cultura deixa de ser discurso e vira prática.
        </p>
        <div className="mt-lg grid grid-cols-1 gap-md md:grid-cols-2">
          <div>
            <h3 className="font-headline text-headline-sm text-on-surface">Nossa cultura diz que:</h3>
            <ul className="mt-sm flex flex-col gap-sm">
              {CULTURA_DIZ.map((item) => (
                <li key={item} className="text-body-md text-on-surface-variant">
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-headline text-headline-sm text-on-surface">O INOVA transforma isso em ação:</h3>
            <ul className="mt-sm flex flex-col gap-sm">
              {INOVA_TRANSFORMA.map((item) => (
                <li key={item} className="text-body-md text-on-surface-variant">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-lg rounded-xl border border-outline-variant/40 bg-surface-container p-md text-center">
          <p className="text-body-md text-on-surface">
            No INOVA, cada pessoa deixa de apenas executar e passa a contribuir ativamente para a evolução da EMR.
          </p>
        </div>
        <p className="mt-md text-center text-body-sm italic text-on-surface-variant">
          Cultura forte não se comunica apenas, se constrói no dia a dia.
        </p>
      </section>

      {/* Comitê de IA */}
      <section className={sectionCard}>
        <div className="absolute inset-x-0 top-0 inova-glow-line" />
        <p className="font-label text-label-md uppercase tracking-[0.2em] text-primary">Governança</p>
        <h2 className="mt-2 font-headline text-headline-lg text-on-surface">Comitê de IA</h2>
        <p className="mt-1 text-body-md text-on-surface-variant">
          Como transformamos iniciativas em decisões estratégicas
        </p>
        <div className="mt-lg flex flex-wrap gap-sm">
          {COMITE_FLUXO.map((passo) => (
            <div key={passo.titulo} className="min-w-[140px] flex-1 rounded-xl border border-outline-variant/40 p-sm text-center">
              <p className="font-label text-label-md text-on-surface">{passo.titulo}</p>
              <p className="mt-1 text-body-sm text-on-surface-variant">{passo.texto}</p>
            </div>
          ))}
        </div>
        <div className="mt-lg grid grid-cols-1 gap-md md:grid-cols-2">
          <div>
            <h3 className="font-headline text-headline-sm text-on-surface">Encontro de Alinhamento</h3>
            <ul className="mt-sm flex flex-col gap-sm">
              {ENCONTRO_ITENS.map((item) => (
                <li key={item} className="text-body-md text-on-surface-variant">
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-headline text-headline-sm text-on-surface">Comitê Executivo</h3>
            <ul className="mt-sm flex flex-col gap-sm">
              {COMITE_ITENS.map((item) => (
                <li key={item} className="text-body-md text-on-surface-variant">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-lg rounded-xl bg-primary/5 p-md text-center">
          <p className="text-body-md text-on-surface">
            O Comitê de IA conecta o que está sendo feito com o que realmente deve escalar.
          </p>
        </div>
      </section>

      {/* Memórias */}
      <section className={sectionCard}>
        <div className="absolute inset-x-0 top-0 inova-glow-line" />
        <p className="font-label text-label-md uppercase tracking-[0.2em] text-primary">Memórias</p>
        <h2 className="mt-2 font-headline text-headline-lg text-on-surface">O caminho que já percorremos</h2>
        <p className="mt-1 text-body-md text-on-surface-variant">
          Cada edição é um passo na nossa evolução. Relembre os momentos que marcaram o INOVA 2025.
        </p>
        <div className="mt-lg grid grid-cols-1 gap-md md:grid-cols-2">
          {MEMORIAS.map((memoria, index) => (
            <button
              key={memoria.url}
              type="button"
              onClick={() => setMemoriaAberta(index)}
              aria-label={`Ampliar imagem: ${memoria.name}`}
              className="group relative overflow-hidden rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              <img
                src={memoria.url}
                alt={memoria.name}
                loading="lazy"
                className="w-full rounded-xl object-cover transition-transform duration-300 group-hover:scale-[1.02]"
              />
              <span className="absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-black/50 to-transparent pb-sm pt-lg font-label text-label-sm text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                Clique para ampliar
              </span>
            </button>
          ))}
        </div>
      </section>

      {memoriaAberta !== null && (
        <ImageLightbox
          images={MEMORIAS}
          index={memoriaAberta}
          onIndexChange={setMemoriaAberta}
          onClose={() => setMemoriaAberta(null)}
        />
      )}

      {/* Impacto */}
      <section className={sectionCard}>
        <div className="absolute inset-x-0 top-0 inova-glow-line" />
        <h2 className="text-center font-headline text-headline-lg text-on-surface">
          Inovação que gera resultado de verdade
        </h2>
        <p className="mt-1 text-center text-body-md text-on-surface-variant">
          Cada área com pelo menos <strong className="text-on-surface">2 projetos estratégicos</strong> com IA até{' '}
          <strong className="text-on-surface">junho de 2026</strong>, porque evoluir com propósito é evoluir juntos.
        </p>
        <div className="mt-lg grid grid-cols-1 gap-md sm:grid-cols-2 md:grid-cols-4">
          {IMPACTOS.map((item) => (
            <div key={item.label} className="inova-glass-card rounded-xl p-md text-center">
              <div className={`${iconCircle} mx-auto mb-3`}>
                <Icon name={item.icone} className="text-[22px] text-[#16321f]" />
              </div>
              <p className="text-body-md font-semibold text-on-surface">{item.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Jornada */}
      <section className={sectionCard}>
        <div className="absolute inset-x-0 top-0 inova-glow-line" />
        <h2 className="text-center font-headline text-headline-lg text-on-surface">Sua jornada de transformação</h2>
        <p className="mt-1 text-center text-body-md text-on-surface-variant">
          Cada etapa é uma oportunidade de crescer, aprender e gerar impacto.
        </p>
        <div className="mt-lg grid grid-cols-1 gap-md sm:grid-cols-2 md:grid-cols-4">
          {JORNADA.map((passo) => (
            <div key={passo.numero} className="inova-glass-card rounded-xl p-md">
              <span className="font-mono text-body-sm text-on-surface-variant">{passo.numero}</span>
              <div className="mb-3 mt-2 flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
                <Icon name={passo.icone} className="text-[20px] text-primary" />
              </div>
              <p className="font-label text-label-md text-on-surface">{passo.titulo}</p>
              <p className="mt-1 text-body-sm text-on-surface-variant">{passo.texto}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Top INOVA EMR */}
      <section className={`${sectionCard} text-center`}>
        <div className="absolute inset-x-0 top-0 inova-glow-line" />
        <h2 className="font-headline text-headline-md text-on-surface">🏆 Projetos de Impacto INOVA EMR</h2>
        <p className="mt-1 text-body-md text-on-surface-variant">
          As iniciativas que chegam à etapa final passam por um processo de avaliação e podem ser premiadas por seu
          impacto e evolução com propósito.
        </p>
      </section>

      {/* CTAs finais */}
      <section className="grid grid-cols-1 gap-md md:grid-cols-2">
        <div className={sectionCard}>
          <div className="absolute inset-x-0 top-0 inova-glow-line" />
          <h2 className="font-headline text-headline-sm text-on-surface">Quer tirar uma ideia do papel?</h2>
          <p className="mt-2 text-body-md text-on-surface-variant">
            Se você tem uma ideia, mas ainda não sabe por onde começar, a gente te ajuda. Fale com o time de{' '}
            <strong className="text-on-surface">Gente &amp; Gestão</strong> para entender como transformar sua ideia
            em um projeto real.
          </p>
          <div className="mt-md rounded-xl border border-outline-variant/40 p-sm">
            <p className="font-label text-label-md text-on-surface">Mariana Venancio</p>
            <p className="text-body-sm text-on-surface-variant">Analista de T&amp;D, EMR</p>
          </div>
          <p className="mt-sm text-body-sm text-on-surface-variant">
            Não precisa ter tudo pronto. O importante é começar, e aqui ninguém constrói sozinho.
          </p>
          <a
            href="https://teams.microsoft.com/l/chat/48:notes/conversations?context=%7B%22contextType%22%3A%22chat%22%7D"
            target="_blank"
            rel="noreferrer"
            className="mt-md inline-flex items-center gap-sm rounded-full border border-outline-variant/60 px-lg py-sm font-label text-label-md text-primary hover:border-primary/60"
          >
            <Icon name="chat" className="text-[18px]" />
            Falar no Teams
          </a>
        </div>
        <div className="relative overflow-hidden rounded-2xl inova-gradient-green p-lg text-center text-[#16321f] md:p-xl">
          <div className="absolute -top-10 -right-10 h-40 w-40 rounded-full bg-white/10" />
          <div className="absolute -bottom-8 -left-8 h-32 w-32 rounded-full bg-white/10" />
          <Icon name="rocket_launch" className="relative z-10 mx-auto mb-3 text-[36px]" />
          <h2 className="relative z-10 font-headline text-headline-sm">O futuro da EMR é construído por você.</h2>
          <p className="relative z-10 mt-2 text-body-md">
            Assuma o protagonismo. Lance seu projeto e faça parte da transformação.
          </p>
          <Link
            to="/comunidade-inova/novo"
            className="relative z-10 mt-md inline-flex items-center gap-sm rounded-full bg-[#16321f] px-lg py-sm font-label text-label-md font-bold text-white shadow-lg hover:opacity-90"
          >
            Começar agora
            <Icon name="arrow_forward" className="text-[18px]" />
          </Link>
        </div>
      </section>
    </div>
  )
}
