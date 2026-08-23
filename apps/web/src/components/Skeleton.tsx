import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { BrandName, BrandTagline } from "./BrandLogo";

/**
 * Bloco base de skeleton. Usa `animate-pulse` + um tom de superfície elevado
 * para contrastar levemente com o card que o contém. `aria-hidden` porque o
 * conteúdo é puramente visual — o estado de carregamento é anunciado pelo
 * wrapper `SkeletonRegion`.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-surface-container-highest ${className}`}
    />
  );
}

/**
 * Envolve um conjunto de skeletons, anunciando "carregando" para leitores de
 * tela sem expor os blocos visuais.
 */
function SkeletonRegion({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export function OrganizationSkeleton() {
  return (
    <SkeletonRegion label="Carregando organograma…">
      <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-xl">
        <Skeleton className="mx-auto h-28 w-64 rounded-2xl" />
        <Skeleton className="mx-auto h-8 w-px rounded-none" />
        <div className="flex flex-col justify-center gap-xl md:flex-row">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="w-full space-y-sm rounded-2xl border border-outline-variant/30 bg-surface-container p-md md:w-[22rem]">
              <div className="flex items-center gap-sm">
                <Skeleton className="h-11 w-11 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
              <Skeleton className="h-20 w-full rounded-xl" />
              <Skeleton className="h-20 w-full rounded-xl" />
            </div>
          ))}
        </div>
      </div>
    </SkeletonRegion>
  );
}

/** Alias preservado para consumidores antigos do skeleton. */
export const TeamSkeleton = OrganizationSkeleton

/** Espelha o LegendCard da galeria de lendas. */
function LegendCardSkeleton() {
  return (
    <div className="flex flex-col items-center rounded-xl border border-outline-variant/30 bg-surface-container p-lg">
      <Skeleton className="mb-md h-24 w-24 rounded-full" />
      <Skeleton className="h-6 w-32" />
      <Skeleton className="mt-xs h-5 w-24 rounded-full" />
      <div className="my-md w-full border-t border-outline-variant/20" />
      <Skeleton className="mb-sm h-3 w-32" />
      <div className="mb-md flex justify-center gap-sm">
        <Skeleton className="h-10 w-10 rounded-full" />
        <Skeleton className="h-10 w-10 rounded-full" />
        <Skeleton className="h-10 w-10 rounded-full" />
      </div>
      <Skeleton className="h-4 w-36" />
    </div>
  );
}

export function LegendsSkeleton({ count = 8 }: { count?: number }) {
  return (
    <SkeletonRegion label="Carregando o time…">
      <div className="grid grid-cols-1 gap-gutter sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: count }).map((_, i) => (
          <LegendCardSkeleton key={i} />
        ))}
      </div>
    </SkeletonRegion>
  );
}

/** Espelha o HighlightCard dos destaques do mês. */
function HighlightCardSkeleton() {
  return (
    <article className="flex flex-col rounded-xl border border-outline-variant/30 bg-surface-container p-lg">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-xs h-6 w-40" />
      <Skeleton className="mt-md aspect-square w-full rounded-lg" />
      <div className="mt-md space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </div>
      <Skeleton className="mt-md h-4 w-40" />
    </article>
  );
}

export function HighlightsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <SkeletonRegion label="Carregando destaques…">
      <div className="grid grid-cols-1 gap-gutter sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: count }).map((_, i) => (
          <HighlightCardSkeleton key={i} />
        ))}
      </div>
    </SkeletonRegion>
  );
}

/** Espelha o item de selo do catálogo. */
function BadgeItemSkeleton() {
  return (
    <li className="space-y-2 rounded-lg border border-slate-800 bg-surface p-4">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-2/3" />
    </li>
  );
}

export function BadgesSkeleton({ count = 6 }: { count?: number }) {
  return (
    <SkeletonRegion label="Carregando selos…">
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: count }).map((_, i) => (
          <BadgeItemSkeleton key={i} />
        ))}
      </ul>
    </SkeletonRegion>
  );
}

/** Linha de colega na seleção da votação. */
function ColleagueRowSkeleton() {
  return (
    <div className="flex items-center gap-md rounded-md border border-outline-variant/30 p-sm">
      <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  );
}

export function ColleagueListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <SkeletonRegion label="Carregando colegas…">
      <div className="flex flex-col gap-2">
        {Array.from({ length: count }).map((_, i) => (
          <ColleagueRowSkeleton key={i} />
        ))}
      </div>
    </SkeletonRegion>
  );
}

/** Formulário de votação completo (duas colunas), usado enquanto o período carrega. */
export function VoteFormSkeleton() {
  return (
    <SkeletonRegion label="Carregando período de votação…">
      <div className="grid grid-cols-12 gap-lg">
        {/* Coluna esquerda — seleção do colega */}
        <div className="col-span-12 flex flex-col gap-lg lg:col-span-4">
          <fieldset className="rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
            <Skeleton className="mb-lg h-7 w-48" />
            <Skeleton className="mb-md h-10 w-full rounded-md" />
            <ColleagueListSkeleton />
          </fieldset>
        </div>
        {/* Coluna direita — categoria + justificativa */}
        <div className="col-span-12 flex flex-col gap-lg lg:col-span-8">
          <fieldset className="rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
            <Skeleton className="mb-lg h-7 w-48" />
            <CategoryGridSkeleton />
          </fieldset>
          <fieldset className="rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
            <Skeleton className="mb-lg h-7 w-64" />
            <Skeleton className="h-28 w-full rounded-lg" />
          </fieldset>
        </div>
      </div>
    </SkeletonRegion>
  );
}

/** Grade de categorias da votação. */
export function CategoryGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <SkeletonRegion label="Carregando categorias…">
      <div className="grid grid-cols-2 gap-md sm:grid-cols-3">
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            className="flex h-full flex-col items-center gap-2 rounded-lg border-2 border-outline-variant/30 bg-surface-container-highest p-md"
          >
            <Skeleton className="h-8 w-8 rounded-md" />
            <Skeleton className="h-3.5 w-20" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

/** Feedbacks no perfil. */
function FeedbackItemSkeleton() {
  return (
    <li className="rounded-lg border border-outline-variant/20 bg-surface-container-low p-md">
      <div className="mb-sm flex items-center gap-sm">
        <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
        <div className="min-w-0 flex-grow space-y-2">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <div className="space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
      </div>
    </li>
  );
}

export function FeedbackListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <SkeletonRegion label="Carregando feedbacks…">
      <ul className="flex flex-col gap-md">
        {Array.from({ length: count }).map((_, i) => (
          <FeedbackItemSkeleton key={i} />
        ))}
      </ul>
    </SkeletonRegion>
  );
}

/** Tela de perfil inteira: herói + galeria de selos + histórico + categorias. */
export function ProfileSkeleton() {
  return (
    <SkeletonRegion label="Carregando perfil…">
      <section className="mx-auto max-w-page p-lg md:p-xl">
        {/* Herói */}
        <div className="mb-lg grid grid-cols-12 gap-lg">
          <div className="col-span-12 flex flex-col items-center gap-xl rounded-xl border border-outline-variant/40 bg-surface-container p-lg md:flex-row lg:col-span-8">
            <Skeleton className="h-32 w-32 shrink-0 rounded-full md:h-36 md:w-36" />
            <div className="flex-grow space-y-md text-center md:text-left">
              <Skeleton className="mx-auto h-9 w-56 md:mx-0" />
              <Skeleton className="mx-auto h-5 w-40 md:mx-0" />
              <div className="flex flex-wrap justify-center gap-sm md:justify-start">
                <Skeleton className="h-7 w-24 rounded-full" />
                <Skeleton className="h-7 w-40 rounded-full" />
              </div>
              <Skeleton className="mx-auto h-10 w-36 rounded-md md:mx-0" />
            </div>
          </div>

          {/* Resumo de impacto */}
          <div className="col-span-12 flex flex-col gap-lg rounded-xl border border-primary/20 bg-primary/5 p-lg lg:col-span-4">
            <Skeleton className="h-4 w-36" />
            <div className="space-y-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-9 w-16" />
            </div>
            <div className="grid grid-cols-2 gap-md">
              <div className="space-y-2 rounded-lg border border-outline-variant/30 bg-surface-container-low p-md">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-6 w-10" />
              </div>
              <div className="space-y-2 rounded-lg border border-outline-variant/30 bg-surface-container-low p-md">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-6 w-10" />
              </div>
            </div>
          </div>
        </div>

        {/* Corpo bento */}
        <div className="grid grid-cols-12 items-start gap-lg">
          {/* Galeria de selos */}
          <div className="col-span-12 rounded-xl border border-outline-variant/40 bg-surface-container p-lg lg:col-span-5">
            <div className="mb-lg flex items-center justify-between">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-20" />
            </div>
            <div className="grid grid-cols-3 gap-md">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="flex flex-col items-center gap-sm rounded-lg border border-outline-variant/20 bg-surface-container-high p-md"
                >
                  <Skeleton className="h-16 w-16 rounded-full" />
                  <Skeleton className="h-3 w-12" />
                </div>
              ))}
            </div>
          </div>

          {/* Lista de feedbacks */}
          <div className="col-span-12 rounded-xl border border-outline-variant/40 bg-surface-container p-lg lg:col-span-7">
            <div className="mb-lg flex items-center justify-between gap-md">
              <Skeleton className="h-6 w-64" />
              <Skeleton className="h-8 w-48 rounded-lg" />
            </div>
            <div className="mb-lg flex gap-sm">
              <Skeleton className="h-8 w-32 rounded-md" />
              <Skeleton className="h-8 w-40 rounded-md" />
            </div>
            <div className="flex flex-col gap-md">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-start gap-md rounded-lg border border-outline-variant/20 bg-surface-container-low p-md"
                >
                  <Skeleton className="h-10 w-10 shrink-0 rounded-md" />
                  <div className="flex-grow space-y-2">
                    <div className="flex items-start justify-between gap-md">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Categorias dos feedbacks */}
          <div className="col-span-12 rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
            <Skeleton className="mb-lg h-6 w-56" />
            <div className="flex flex-col gap-md">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-3.5 w-40" />
                    <Skeleton className="h-3.5 w-6" />
                  </div>
                  <Skeleton className="h-1.5 w-full rounded-full" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </SkeletonRegion>
  );
}

/** Cabeçalho genérico de página (título + subtítulo). */
function PageHeaderSkeleton() {
  return (
    <header className="mb-xl space-y-3">
      <Skeleton className="h-9 w-64 max-w-full" />
      <Skeleton className="h-4 w-96 max-w-full" />
    </header>
  );
}

/** Skeleton genérico do painel administrativo. */
function AdminSkeleton() {
  return (
    <section className="mx-auto max-w-page p-lg md:p-xl">
      <PageHeaderSkeleton />
      <div className="mb-lg flex gap-sm">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-28 rounded-md" />
        ))}
      </div>
      <div className="space-y-md">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    </section>
  );
}

/** Escolhe o skeleton de conteúdo fiel à rota atual. */
function RouteContentSkeleton({ pathname }: { pathname: string }) {
  // O perfil já traz a própria <section> com herói — devolve direto.
  if (pathname.startsWith("/perfil")) return <ProfileSkeleton />;
  if (pathname.startsWith("/admin")) return <AdminSkeleton />;

  let content: ReactNode;
  if (pathname.startsWith("/lendas")) content = <LegendsSkeleton />;
  else if (pathname.startsWith("/destaques")) content = <HighlightsSkeleton />;
  else if (pathname.startsWith("/engajamento")) content = <BadgesSkeleton />;
  // /selos só redireciona para /engajamento, mas o skeleton cobre o instante do redirect.
  else if (pathname.startsWith("/selos")) content = <BadgesSkeleton />;
  else if (pathname.startsWith("/votar")) content = <VoteFormSkeleton />;
  else content = <OrganizationSkeleton />; // /time e fallback

  return (
    <section className="mx-auto max-w-page p-lg md:p-xl">
      <PageHeaderSkeleton />
      {content}
    </section>
  );
}

/**
 * Skeleton de tela cheia exibido enquanto a sessão é restaurada (ex.: F5).
 * Reproduz o chrome do AppLayout (sidebar + topbar) e injeta o skeleton da
 * rota atual no lugar do conteúdo, evitando o "Carregando…" genérico.
 */
export function AppShellSkeleton() {
  const { pathname } = useLocation();

  // /alterar-senha é uma página centralizada, fora do AppLayout.
  if (pathname.startsWith("/alterar-senha")) {
    return (
      <SkeletonRegion label="Carregando…">
        <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-lg p-lg">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-full" />
          <div className="space-y-md">
            <Skeleton className="h-12 w-full rounded-md" />
            <Skeleton className="h-12 w-full rounded-md" />
            <Skeleton className="h-12 w-full rounded-md" />
          </div>
          <Skeleton className="h-11 w-40 rounded-md" />
        </div>
      </SkeletonRegion>
    );
  }

  return (
    <SkeletonRegion label="Carregando…">
      <div className="min-h-screen bg-surface text-on-surface">
        {/* Sidebar — espelha o AppLayout */}
        <aside className="fixed left-0 top-0 z-50 hidden h-screen w-20 flex-col border-r border-outline-variant/40 bg-surface-container-lowest py-xl md:flex lg:w-64">
          <div className="mb-xl hidden px-lg lg:block">
            <h1 className="font-headline text-headline-md font-bold tracking-tight text-primary">
              <BrandName />
            </h1>
            <BrandTagline className="mt-1 font-label text-[10px] uppercase tracking-[0.2em] text-on-surface-variant" />
          </div>
          <nav className="flex flex-1 flex-col gap-1 px-sm">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center justify-center gap-md rounded-md px-md py-sm lg:justify-start"
              >
                <Skeleton className="h-[26px] w-[26px] shrink-0 rounded-md" />
                <Skeleton className="hidden h-4 w-24 lg:block" />
              </div>
            ))}
          </nav>
          <div className="mt-auto px-sm lg:px-md">
            <div className="border-t border-outline-variant/40 pt-md">
              <div className="flex items-center justify-center gap-md px-md py-sm lg:justify-start">
                <Skeleton className="h-5 w-5 shrink-0 rounded-md" />
                <Skeleton className="hidden h-4 w-16 lg:block" />
              </div>
            </div>
          </div>
        </aside>

        {/* Coluna principal */}
        <div className="ml-0 flex min-h-screen flex-col md:ml-20 lg:ml-64">
          <header className="sticky top-0 z-40 flex items-center justify-between border-b border-outline-variant/40 bg-surface-container/80 px-xl py-md backdrop-blur-md">
            <h1 className="font-headline text-headline-md font-bold tracking-tight text-primary md:hidden">
              <BrandName />
            </h1>
            <Skeleton className="hidden h-9 w-48 rounded-full sm:block lg:w-64" />
            <div className="flex items-center gap-sm">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="hidden space-y-1.5 md:block">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
          </header>

          <main className="flex-1 pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0">
            <RouteContentSkeleton pathname={pathname} />
          </main>
        </div>
      </div>
    </SkeletonRegion>
  );
}
