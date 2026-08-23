import { ResenhaFeed } from './ResenhaFeed'

export function ResenhaPage() {
  // A conexão de tempo real vive no ResenhaFeed (o feed é "ao vivo" onde aparecer).
  return (
    <section className="mx-auto max-w-page p-lg md:p-xl">
      <h1 className="mb-lg font-headline text-headline-xl text-on-surface">Resenha</h1>
      <ResenhaFeed />
    </section>
  )
}
