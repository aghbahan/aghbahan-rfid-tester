// Сервис управления Chameleon Ultra: подключение один раз → авто-переподключение
// при пробуждении гаджета → эмуляция метки по типу → окно «держи у двери» →
// авто-отключение → сон. Только авто-отключение (кнопки «Отключить» нет).

import { Buffer, ChameleonUltra, DeviceMode, Slot, TagType } from 'chameleon-ultra.js'
import ReconnectWebbleAdapter from './bleAdapter'
import type { Card } from './cards'

export type ConnState = 'unpaired' | 'connecting' | 'ready' | 'emitting' | 'sleeping'
export type LogType = 'info' | 'ok' | 'error'

export interface ChSnapshot {
  state: ConnState
  battery: number | null
  activeCardId: string | null
  holdSeconds: number
}

const WORK_SLOT = Slot.SLOT_1
const HOLD_SECONDS = 15 // держим связь после излучения (окно «поднеси к двери»)
const SLEEP_SETTLE_MS = 5000 // пауза после отключения, чтобы гаджет успел заснуть

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

class ChameleonService {
  readonly ultra = new ChameleonUltra()
  #used = false
  #active = false
  #paused = false
  #connectInFlight = false
  #loopRunning = false
  #state: ConnState = 'unpaired'
  #battery: number | null = null
  #activeCardId: string | null = null
  #holdSeconds = 0
  #holdTimer: ReturnType<typeof setInterval> | null = null
  #stateListeners = new Set<(s: ChSnapshot) => void>()
  #logListeners = new Set<(msg: string, type: LogType) => void>()

  constructor() {
    this.ultra.emitter.on('connected', () => {
      this.#setState('ready')
      void this.refreshBattery()
    })
    this.ultra.emitter.on('disconnected', () => {
      this.#activeCardId = null
      this.#clearHold()
      this.#setState(this.#active ? 'sleeping' : 'unpaired')
    })
  }

  // ---------- подписки ----------
  subscribe(cb: (s: ChSnapshot) => void): () => void {
    this.#stateListeners.add(cb)
    cb(this.snapshot())
    return () => this.#stateListeners.delete(cb)
  }
  onLog(cb: (msg: string, type: LogType) => void): () => void {
    this.#logListeners.add(cb)
    return () => this.#logListeners.delete(cb)
  }
  snapshot(): ChSnapshot {
    return {
      state: this.#state,
      battery: this.#battery,
      activeCardId: this.#activeCardId,
      holdSeconds: this.#holdSeconds,
    }
  }
  #emit(): void {
    const s = this.snapshot()
    for (const cb of this.#stateListeners) cb(s)
  }
  #log(msg: string, type: LogType = 'info'): void {
    for (const cb of this.#logListeners) cb(msg, type)
  }
  #setState(s: ConnState): void {
    this.#state = s
    this.#emit()
  }

  get isConnected(): boolean {
    return this.ultra.isConnected()
  }

  async #ensureAdapter(): Promise<void> {
    if (this.#used) return
    await this.ultra.use(new ReconnectWebbleAdapter())
    this.#used = true
  }

  async #connectGuarded(): Promise<boolean> {
    if (this.ultra.isConnected()) return true
    if (this.#connectInFlight) return false
    this.#connectInFlight = true
    try {
      await this.ultra.connect()
      return true
    } catch {
      return false
    } finally {
      this.#connectInFlight = false
    }
  }

  // ---------- первое сопряжение (по клику) ----------
  async pair(): Promise<void> {
    await this.#ensureAdapter()
    this.#active = true
    this.#paused = false
    this.#setState('connecting')
    this.#log('Подключение…')
    const ok = await this.#connectGuarded()
    if (ok) {
      this.#log('Подключено ✅', 'ok')
      this.#startReconnectLoop()
    } else {
      this.#log('Не удалось подключиться. Разбуди гаджет кнопкой и попробуй снова.', 'error')
      if (!this.ultra.isConnected()) this.#setState('unpaired')
    }
  }

  // ---------- фоновое переподключение при пробуждении ----------
  #startReconnectLoop(): void {
    if (this.#loopRunning) return
    this.#loopRunning = true
    void (async () => {
      while (this.#active) {
        if (!this.ultra.isConnected() && !this.#paused) {
          await this.#connectGuarded() // тихо: окно выбора не показывается
        }
        await sleep(1500)
      }
      this.#loopRunning = false
    })()
  }

  // ---------- эмуляция метки ----------
  async emulate(card: Card): Promise<void> {
    if (!this.ultra.isConnected()) {
      this.#log('Гаджет спит — нажми кнопку на гаджете, чтобы он проснулся.', 'error')
      return
    }
    try {
      this.#log(`Готовлю «${card.name}» (${card.uid})…`)
      await this.ultra.cmdChangeDeviceMode(DeviceMode.TAG)
      if (card.chipType === 'EM410X') {
        await this.ultra.slotChangeTagTypeAndActive(WORK_SLOT, null, TagType.EM410X)
        await this.ultra.cmdEm410xSetEmuId(Buffer.from(card.uid, 'hex'))
      } else {
        await this.ultra.slotChangeTagTypeAndActive(WORK_SLOT, TagType.MIFARE_1024, null)
        await this.ultra.cmdHf14aSetAntiCollData({
          uid: Buffer.from(card.uid, 'hex'),
          atqa: Buffer.from('0400', 'hex'),
          sak: Buffer.of(0x08),
        })
      }
      await this.ultra.cmdSlotSaveSettings()
      this.#activeCardId = card.id
      this.#log(`Излучается: «${card.name}» — поднеси Chameleon к домофону 🔑`, 'ok')
      this.#startHold()
    } catch (e) {
      this.#log('Ошибка эмуляции: ' + errMsg(e), 'error')
    }
  }

  // ---------- окно «держи у двери» → авто-отключение ----------
  #startHold(): void {
    this.#clearHold()
    this.#holdSeconds = HOLD_SECONDS
    this.#setState('emitting')
    this.#holdTimer = setInterval(() => {
      this.#holdSeconds -= 1
      if (this.#holdSeconds <= 0) {
        this.#clearHold()
        void this.#sleepNow()
      } else {
        this.#emit()
      }
    }, 1000)
  }
  #clearHold(): void {
    if (this.#holdTimer !== null) {
      clearInterval(this.#holdTimer)
      this.#holdTimer = null
    }
    this.#holdSeconds = 0
  }

  async #sleepNow(): Promise<void> {
    this.#activeCardId = null
    this.#paused = true
    this.#setState('sleeping')
    this.#log('Отключаюсь — гаджет засыпает 💤')
    await this.ultra.disconnect().catch(() => {})
    await sleep(SLEEP_SETTLE_MS)
    this.#paused = false // цикл возобновится → переподключится, когда разбудишь кнопкой
  }

  async refreshBattery(): Promise<void> {
    try {
      const b = (await this.ultra.cmdGetBatteryInfo()) as { level?: number }
      this.#battery = typeof b?.level === 'number' ? b.level : null
      this.#emit()
    } catch {
      /* старая прошивка может не поддерживать */
    }
  }
}

export const chameleon = new ChameleonService()
