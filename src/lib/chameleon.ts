// Сервис управления Chameleon Ultra: подключение один раз → авто-переподключение при
// пробуждении гаджета → эмуляция метки по типу → окно «держи у двери» → авто-отключение.
// Плюс: авто-сон при простое (нет действий N секунд → отключаюсь → гаджет спит) и
// восстановление устройства после перезагрузки страницы (getDevices).

import { Buffer, ChameleonUltra, DeviceMode, Slot, TagType } from 'chameleon-ultra.js'
import ReconnectWebbleAdapter, { isPaired, tryRestoreDevice } from './bleAdapter'
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
const IDLE_DISCONNECT_MS = 25000 // нет действий на связи → отключаюсь → гаджет спит

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

class ChameleonService {
  readonly ultra = new ChameleonUltra()
  #used = false
  #inited = false
  #active = false
  #paused = false
  #connectInFlight = false
  #loopRunning = false
  #state: ConnState = 'unpaired'
  #battery: number | null = null
  #activeCardId: string | null = null
  #holdSeconds = 0
  #holdTimer: ReturnType<typeof setInterval> | null = null
  #idleTimer: ReturnType<typeof setTimeout> | null = null
  #stateListeners = new Set<(s: ChSnapshot) => void>()
  #logListeners = new Set<(msg: string, type: LogType) => void>()

  constructor() {
    this.ultra.emitter.on('connected', () => {
      this.#setState('ready')
      this.#log('На связи ✅', 'ok')
      void this.#readBattery()
      this.#startIdle()
    })
    this.ultra.emitter.on('disconnected', () => {
      this.#activeCardId = null
      this.#clearHold()
      this.#clearIdle()
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
    return { state: this.#state, battery: this.#battery, activeCardId: this.#activeCardId, holdSeconds: this.#holdSeconds }
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

  // ---------- старт: вернуть ранее выданное устройство (после перезагрузки) ----------
  async init(): Promise<void> {
    if (this.#inited) return
    this.#inited = true
    try {
      await this.#ensureAdapter()
      const restored = await tryRestoreDevice()
      if (restored) {
        this.#active = true
        this.#paused = false
        this.#setState('sleeping')
        this.#log('Гаджет запомнен. Разбуди его кнопкой — подключусь сам.')
        this.#startReconnectLoop()
      } else {
        this.#setState('unpaired')
      }
    } catch {
      this.#setState('unpaired')
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
      this.#log('Не удалось подключиться. Разбуди гаджет кнопкой и попробуй ещё раз.', 'error')
      if (!this.ultra.isConnected()) this.#setState(isPaired() ? 'sleeping' : 'unpaired')
    }
  }

  // ---------- фоновое переподключение при пробуждении (без окна выбора) ----------
  #startReconnectLoop(): void {
    if (this.#loopRunning) return
    this.#loopRunning = true
    void (async () => {
      while (this.#active) {
        if (!this.ultra.isConnected() && !this.#paused) {
          await this.#connectGuarded()
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
    this.#clearIdle()
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
      void this.#readBattery()
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

  // ---------- авто-сон при простое ----------
  #startIdle(): void {
    this.#clearIdle()
    this.#idleTimer = setTimeout(() => {
      if (this.#state === 'ready') {
        this.#log('Нет действий — усыпляю для экономии 💤')
        void this.#sleepNow()
      }
    }, IDLE_DISCONNECT_MS)
  }
  #clearIdle(): void {
    if (this.#idleTimer !== null) {
      clearTimeout(this.#idleTimer)
      this.#idleTimer = null
    }
  }

  async #sleepNow(): Promise<void> {
    this.#activeCardId = null
    this.#clearIdle()
    this.#paused = true
    this.#setState('sleeping')
    await this.ultra.disconnect().catch(() => {})
    await sleep(SLEEP_SETTLE_MS)
    this.#paused = false // цикл возобновится → переподключится, когда разбудишь кнопкой
  }

  async #readBattery(): Promise<void> {
    for (let i = 0; i < 2; i++) {
      try {
        const b = (await this.ultra.cmdGetBatteryInfo()) as { level?: number }
        if (typeof b?.level === 'number' && b.level > 0) {
          this.#battery = b.level
          this.#emit()
          return
        }
      } catch {
        /* старая прошивка / занято — пробуем ещё раз */
      }
      await sleep(400)
    }
  }
}

export const chameleon = new ChameleonService()
