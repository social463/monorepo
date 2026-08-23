import { useState } from 'react'
import { Icon } from '../../components/Icon'
import { isApplauseMuted, setApplauseMuted } from '../media/applause-sound'
import { OFFICE_SHORTCUT_GROUPS } from './office-shortcuts'
import { ShortcutKeycap } from './ShortcutKeycap'

type SettingsTab = 'atalhos' | 'preferencias'

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'atalhos', label: 'Atalhos' },
  { id: 'preferencias', label: 'Preferências' },
]

function ShortcutsTab() {
  return (
    <div className="flex flex-col gap-lg">
      {OFFICE_SHORTCUT_GROUPS.map((group, index) => {
        const titleId = `office-shortcuts-${index}`
        return (
          <section key={group.title} aria-labelledby={titleId}>
            <h2
              id={titleId}
              className="mb-sm flex items-center gap-xs font-label text-label-md font-bold text-on-surface"
            >
              <Icon name={group.icon} className="text-[18px] text-primary" />
              {group.title}
            </h2>
            <div className="divide-y divide-outline-variant/20 rounded-lg border border-outline-variant/30 bg-surface/55">
              {group.items.map((item) => (
                <div
                  key={`${group.title}-${item.label}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-md px-md py-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-label text-label-sm text-on-surface">{item.label}</p>
                    <p className="mt-0.5 font-body text-body-sm leading-snug text-on-surface-variant">
                      {item.context}
                    </p>
                  </div>
                  <ShortcutKeycap keys={item.keys} />
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function PreferencesTab() {
  // A preferência vive no módulo do som (a cena Phaser também a lê), então o
  // estado local aqui é só o espelho para renderizar.
  const [applauseOn, setApplauseOn] = useState(() => !isApplauseMuted())

  function toggleApplause() {
    const next = !applauseOn
    setApplauseOn(next)
    setApplauseMuted(!next)
  }

  return (
    <section aria-labelledby="office-preferences-som">
      <h2
        id="office-preferences-som"
        className="mb-sm flex items-center gap-xs font-label text-label-md font-bold text-on-surface"
      >
        <Icon name="volume_up" className="text-[18px] text-primary" />
        Som
      </h2>
      <div className="rounded-lg border border-outline-variant/30 bg-surface/55">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-md px-md py-sm">
          <div className="min-w-0">
            <p className="font-label text-label-sm text-on-surface">Som da comemoração</p>
            <p className="mt-0.5 font-body text-body-sm leading-snug text-on-surface-variant">
              Toca as palmas quando alguém chama a comemoração. Desligar tira só o som — o
              confete e a animação continuam.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={applauseOn}
            aria-label="Som da comemoração"
            onClick={toggleApplause}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
              applauseOn ? 'bg-primary' : 'bg-surface-container-highest'
            }`}
          >
            <span
              className={`absolute top-1 h-5 w-5 rounded-full bg-surface transition-all ${
                applauseOn ? 'left-6' : 'left-1'
              }`}
            />
          </button>
        </div>
      </div>
    </section>
  )
}

export function OfficeSettingsPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<SettingsTab>('atalhos')

  return (
    <aside className="flex h-full w-[22rem] max-w-[calc(100vw-68px)] flex-col overflow-hidden border-r border-outline-variant/40 bg-surface-container/95 shadow-2xl backdrop-blur">
      <header className="border-b border-outline-variant/30 px-lg py-lg">
        <div className="mb-md flex items-start justify-between gap-md">
          <div className="min-w-0">
            <span className="font-label text-[11px] uppercase tracking-wide text-primary">Escritório virtual</span>
            <h1 className="truncate font-headline text-headline-sm text-on-surface">Configurações</h1>
          </div>
          <button
            type="button"
            aria-label="Fechar configurações"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-on-surface"
          >
            <Icon name="dock_to_left" className="text-[20px]" />
          </button>
        </div>

        <div role="tablist" aria-label="Configurações do escritório" className="flex gap-xs">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`office-settings-tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`office-settings-panel-${id}`}
              onClick={() => setTab(id)}
              className={`rounded-md px-md py-xs font-label text-label-sm font-bold transition-colors ${
                tab === id
                  ? 'bg-primary text-on-primary'
                  : 'text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <div
        role="tabpanel"
        id={`office-settings-panel-${tab}`}
        aria-labelledby={`office-settings-tab-${tab}`}
        className="min-h-0 flex-1 overflow-y-auto px-lg py-lg"
      >
        {tab === 'atalhos' ? <ShortcutsTab /> : <PreferencesTab />}
      </div>
    </aside>
  )
}
