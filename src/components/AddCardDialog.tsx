import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { newId, normalizeUid, optionByValue, TAG_OPTIONS, uidHintFor, type Card } from '@/lib/cards'

export function AddCardDialog({
  open,
  onOpenChange,
  onSave,
  editing,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onSave: (card: Card) => void
  editing: Card | null
}) {
  const [name, setName] = useState('')
  const [optValue, setOptValue] = useState('standard')
  const [uid, setUid] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    if (editing) {
      setName(editing.name)
      setUid(editing.uid)
      const opt = TAG_OPTIONS.find((o) => o.brand === editing.brand && o.chipType === editing.chipType)
      setOptValue(opt?.value ?? (editing.chipType === 'EM410X' ? 'standard' : 'other-mifare'))
    } else {
      setName('')
      setUid('')
      setOptValue('standard')
    }
  }, [open, editing])

  const opt = optionByValue(optValue)

  function submit() {
    const nm = name.trim()
    if (!nm) {
      setError('Введи название адреса')
      return
    }
    const normalized = normalizeUid(uid, opt.chipType)
    if (!normalized) {
      setError('Неверный UID — нужно ' + uidHintFor(opt.chipType))
      return
    }
    onSave({ id: editing?.id ?? newId(), name: nm, brand: opt.brand, chipType: opt.chipType, uid: normalized })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Изменить карточку' : 'Новая карточка'}</DialogTitle>
          <DialogDescription>Адрес, тип метки и её UID (считанный Flipper'ом).</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-1">
          <div className="grid gap-1.5">
            <Label htmlFor="card-name">Название адреса</Label>
            <Input id="card-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="напр. Абовяна 5, 2 подъезд" />
          </div>

          <div className="grid gap-1.5">
            <Label>Тип метки / бренд домофона</Label>
            <Select
              items={TAG_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
              value={optValue}
              onValueChange={(v) => setOptValue(v ?? 'standard')}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TAG_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{opt.hint}</p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="card-uid">UID</Label>
            <Input
              id="card-uid"
              value={uid}
              onChange={(e) => setUid(e.target.value)}
              placeholder={uidHintFor(opt.chipType)}
              className="font-mono"
              autoCapitalize="characters"
              autoComplete="off"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={submit}>{editing ? 'Сохранить' : 'Добавить'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
