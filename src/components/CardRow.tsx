import { KeyRound, Pencil, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { Card } from '@/lib/cards'

export function CardRow({
  card,
  disabled,
  active,
  onOpen,
  onEdit,
  onDelete,
}: {
  card: Card
  disabled: boolean
  active: boolean
  onOpen: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className={`flex items-center justify-between gap-2 rounded-xl border bg-card p-3 ${active ? 'ring-2 ring-emerald-500' : ''}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold">{card.name}</span>
          <Badge variant="secondary" className="shrink-0">
            {card.brand}
          </Badge>
        </div>
        <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
          {card.chipType === 'EM410X' ? 'EM-Marine' : 'MIFARE'} · {card.uid}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button size="sm" disabled={disabled} onClick={onOpen} className="gap-1 bg-emerald-600 text-white hover:bg-emerald-600/90">
          <KeyRound className="size-4" />
          Открыть
        </Button>
        <Button size="icon" variant="ghost" onClick={onEdit} aria-label="Изменить">
          <Pencil className="size-4" />
        </Button>
        <Button size="icon" variant="ghost" onClick={onDelete} aria-label="Удалить">
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  )
}
