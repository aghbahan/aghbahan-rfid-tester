import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function HelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Памятка: как читать метку на Flipper</DialogTitle>
          <DialogDescription>По типу/бренду выбери, каким приложением читать.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div>
            <p className="font-semibold">1. Посмотри бренд домофона на панели</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
              <li>FNET / BOON / Hikvision / urban (логотип) → метка <b>NFC (13.56 МГц)</b></li>
              <li>Обычный подъезд → чаще <b>125 кГц (EM-Marine)</b></li>
            </ul>
          </div>

          <div>
            <p className="font-semibold">2. Читай в Flipper</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Обычная / не знаешь → <b>125 kHz RFID → Read</b> (строка Hex = 5 байт)</li>
              <li>Брендовая / не прочиталось → <b>NFC → Read</b> (подожди «Keys Found»)</li>
              <li>Контактная металлическая → <b>iButton → Read</b></li>
            </ul>
          </div>

          <div>
            <p className="font-semibold">3. Сохрани и передай владельцу</p>
            <p className="mt-1 text-muted-foreground">Save → запиши <b>бренд + тип + код (UID)</b> → отправь.</p>
          </div>

          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-amber-200">
            <p className="font-semibold">Что эмулирует Chameleon</p>
            <p className="mt-1">EM-Marine (125 кГц) и MIFARE (13.56 МГц). <b>Контактные таблетки</b> (iButton / Cyfral / Metakom) он не умеет — для них нужен Flipper или физический дубликат.</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
