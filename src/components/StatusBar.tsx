import { BatteryMedium, BluetoothConnected, BluetoothOff, Loader2, Moon, Radio } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ChSnapshot, ConnState } from '@/lib/chameleon'

type Meta = { label: string; hint: string; cls: string; Icon: typeof Moon }

const MAP: Record<ConnState, Meta> = {
  unpaired: { label: 'Не подключено', hint: 'Подключись к Chameleon один раз', cls: 'border-border bg-muted/40 text-foreground', Icon: BluetoothOff },
  connecting: { label: 'Подключение…', hint: 'Ищу гаджет', cls: 'border-blue-500/40 bg-blue-500/10 text-blue-300', Icon: Loader2 },
  ready: { label: 'Готов', hint: 'Выбери адрес и поднеси к домофону', cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300', Icon: BluetoothConnected },
  emitting: { label: 'Излучается', hint: 'Поднеси Chameleon к домофону', cls: 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200', Icon: Radio },
  sleeping: { label: 'Спит', hint: 'Нажми кнопку на гаджете, чтобы разбудить', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-300', Icon: Moon },
}

export function StatusBar({ snap, onPair }: { snap: ChSnapshot; onPair: () => void }) {
  const m = MAP[snap.state]
  const Icon = m.Icon
  return (
    <div className={`flex items-center justify-between gap-3 rounded-xl border p-4 ${m.cls}`}>
      <div className="flex items-center gap-3">
        <Icon className={`size-6 shrink-0 ${snap.state === 'connecting' ? 'animate-spin' : ''}`} />
        <div>
          <div className="text-base font-semibold leading-tight">{m.label}</div>
          <div className="text-xs opacity-80">{m.hint}</div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {snap.battery !== null && (
          <span className="flex items-center gap-1 text-sm font-medium">
            <BatteryMedium className="size-4" />
            {snap.battery}%
          </span>
        )}
        {(snap.state === 'unpaired' || snap.state === 'sleeping') && (
          <Button size="sm" onClick={onPair}>
            Подключить
          </Button>
        )}
      </div>
    </div>
  )
}
