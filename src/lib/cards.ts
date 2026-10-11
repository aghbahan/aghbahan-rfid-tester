// Данные карточек адресов + типы меток. Хранение локальное (localStorage), без бэкенда.

export type ChipType = 'EM410X' | 'MIFARE_1K'

export interface Card {
  id: string
  name: string
  brand: string
  chipType: ChipType
  uid: string // нормализованный hex (10 симв. для EM410X; 8 симв. для MIFARE 1K)
}

export interface TagOption {
  value: string
  label: string
  brand: string
  chipType: ChipType
  hint: string // как читать на Flipper
}

// Варианты «тип/бренд» — бренд даёт подсказку, chipType решает способ эмуляции.
export const TAG_OPTIONS: TagOption[] = [
  { value: 'standard', label: 'Стандартная — EM-Marine (125 кГц)', brand: 'Стандартная', chipType: 'EM410X', hint: 'Flipper: 125 kHz RFID → Read' },
  { value: 'boon', label: 'BOON — MIFARE (13.56 МГц)', brand: 'BOON', chipType: 'MIFARE_1K', hint: 'Flipper: NFC → Read' },
  { value: 'fnet', label: 'FNET — MIFARE (13.56 МГц)', brand: 'FNET', chipType: 'MIFARE_1K', hint: 'Flipper: NFC → Read' },
  { value: 'hikvision', label: 'Hikvision — MIFARE (13.56 МГц)', brand: 'Hikvision', chipType: 'MIFARE_1K', hint: 'Flipper: NFC → Read' },
  { value: 'urban', label: 'urban — MIFARE (13.56 МГц)', brand: 'urban', chipType: 'MIFARE_1K', hint: 'Flipper: NFC → Read' },
  { value: 'other-mifare', label: 'Другая MIFARE (13.56 МГц)', brand: 'Другая', chipType: 'MIFARE_1K', hint: 'Flipper: NFC → Read' },
]

export function optionByValue(value: string): TagOption {
  return TAG_OPTIONS.find((o) => o.value === value) ?? TAG_OPTIONS[0]
}

// Привести UID к hex в верхнем регистре; проверить длину по типу. Иначе null.
export function normalizeUid(raw: string, chipType: ChipType): string | null {
  const hex = (raw ?? '').replace(/[^0-9a-fA-F]/g, '').toUpperCase()
  if (chipType === 'EM410X') return hex.length === 10 ? hex : null
  // MIFARE: 4 / 7 / 10 байт = 8 / 14 / 20 hex
  return [8, 14, 20].includes(hex.length) ? hex : null
}

export function uidHintFor(chipType: ChipType): string {
  return chipType === 'EM410X'
    ? '10 hex = 5 байт, напр. 3600403CBA'
    : '8 hex = 4 байта (UID), напр. 40B90D9C'
}

const STORAGE_KEY = 'aghbahan_rfid_cards_v2'

export function loadCards(): Card[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Card[]) : []
  } catch {
    return []
  }
}

export function saveCards(cards: Card[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cards))
  } catch {
    /* приватный режим / нет места — карточки останутся в памяти сессии */
  }
}

export function newId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  }
}
