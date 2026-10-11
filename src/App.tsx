import { useEffect, useState } from 'react'
import { HelpCircle, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AddCardDialog } from '@/components/AddCardDialog'
import { CardRow } from '@/components/CardRow'
import { HelpDialog } from '@/components/HelpDialog'
import { StatusBar } from '@/components/StatusBar'
import { useChameleon } from '@/hooks/useChameleon'
import { chameleon } from '@/lib/chameleon'
import { loadCards, saveCards, type Card } from '@/lib/cards'

export default function App() {
  const { snap, logs, clearLogs } = useChameleon()
  const [cards, setCards] = useState<Card[]>(() => loadCards())
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Card | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)

  useEffect(() => {
    saveCards(cards)
  }, [cards])

  const ready = snap.state === 'ready' || snap.state === 'emitting'

  function saveCard(card: Card) {
    setCards((prev) => {
      const i = prev.findIndex((c) => c.id === card.id)
      if (i >= 0) {
        const next = [...prev]
        next[i] = card
        return next
      }
      return [...prev, card]
    })
  }

  function removeCard(card: Card) {
    if (confirm(`Удалить «${card.name}»?`)) setCards((prev) => prev.filter((c) => c.id !== card.id))
  }

  return (
    <div className="mx-auto min-h-dvh max-w-xl px-4 pb-10 pt-4">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold leading-tight">Aghbahan · Тестер меток</h1>
          <p className="text-xs text-muted-foreground">Chameleon Ultra по Bluetooth</p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setHelpOpen(true)} aria-label="Памятка">
          <HelpCircle className="size-5" />
        </Button>
      </header>

      <StatusBar snap={snap} onPair={() => void chameleon.pair()} />

      {snap.state === 'emitting' && (
        <div className="mt-3 rounded-xl border border-emerald-600/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          Излучается — поднеси к домофону. Отключусь через <b>{snap.holdSeconds}</b> с.
        </div>
      )}

      <div className="mb-2 mt-6 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">Адреса {cards.length ? `(${cards.length})` : ''}</h2>
        <Button
          size="sm"
          className="gap-1"
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
        >
          <Plus className="size-4" />
          Добавить
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        {cards.length === 0 && (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Нет карточек. Нажми «Добавить».</p>
        )}
        {cards.map((c) => (
          <CardRow
            key={c.id}
            card={c}
            active={snap.activeCardId === c.id}
            disabled={!ready}
            onOpen={() => void chameleon.emulate(c)}
            onEdit={() => {
              setEditing(c)
              setDialogOpen(true)
            }}
            onDelete={() => removeCard(c)}
          />
        ))}
      </div>

      <section className="mt-8">
        <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
          <span>Журнал</span>
          <button className="hover:text-foreground" onClick={clearLogs}>
            Очистить
          </button>
        </div>
        <div className="h-40 overflow-y-auto rounded-xl border bg-black/30 p-2 font-mono text-xs leading-relaxed">
          {logs.length === 0 && <div className="text-muted-foreground">Готово. 1) Подключить 2) добавить адреса 3) «Открыть» у двери.</div>}
          {logs.map((l) => (
            <div key={l.id} className={l.type === 'ok' ? 'text-emerald-400' : l.type === 'error' ? 'text-red-400' : 'text-muted-foreground'}>
              <span className="text-foreground/30">{l.time}</span> {l.msg}
            </div>
          ))}
        </div>
      </section>

      <AddCardDialog open={dialogOpen} onOpenChange={setDialogOpen} onSave={saveCard} editing={editing} />
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  )
}
