// Сервис управления Chameleon Ultra.
// Два пути подключения, без конкуренции:
//  • Первое сопряжение (pair) — по клику, может показать окно выбора (нужен жест).
//  • Переподключение — фоновый цикл: когда гаджет просыпается (кнопкой), цепляемся сами,
//    без окна выбора. Кнопка «Подключить» в состоянии «Спит» просто будит/запускает цикл.
// Простой на связи N секунд → авто-отключение → гаджет спит. Подробный журнал.

import { Buffer, ChameleonUltra, DeviceMode, Slot, TagType } from 'chameleon-ultra.js'
import ReconnectWebbleAdapter, { forgetDevice, isPaired, tryRestoreDevice } from './bleAdapter'
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
const HOLD_SECONDS = 15
const SLEEP_SETTLE_MS = 5000
const IDLE_DISCONNECT_MS = 25000
const LOOP_INTERVAL_MS = 2000

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
  #waitLogged = false
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
      this.#waitLogged = false
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
    this.ultra.emitter.on('error', (e: any) => {
      const m = errMsg(e?.cause ?? e)
      if (!/disconnect|gattserver/i.test(m)) this.#log('BLE: ' + m, 'error')
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

  // Единственная точка фактического подключения (защищена от параллельных вызовов).
  async #connect(verbose: boolean): Promise<boolean> {
    if (this.ultra.isConnected()) return true
    if (this.#connectInFlight) {
      if (verbose) this.#log('Уже подключаюсь, секунду…')
      return false
    }
    this.#connectInFlight = true
    try {
      await this.ultra.connect()
      return true
    } catch (e) {
      if (verbose) this.#log('Не вышло: ' + errMsg(e), 'error')
      return false
    } finally {
      this.#connectInFlight = false
    }
  }

  // ---------- старт приложения: вернуть устройство после перезагрузки ----------
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
        this.#log('Гаджет запомнен. Нажми кнопку на нём — подключусь сам.')
        this.#startReconnectLoop()
      } else {
        this.#setState('unpaired')
      }
    } catch {
      this.#setState('unpaired')
    }
  }

  // ---------- кнопка «Подключить» ----------
  async pair(): Promise<void> {
    await this.#ensureAdapter()
    this.#active = true
    this.#paused = false

    if (!isPaired()) {
      // первое сопряжение — по клику можно показать окно выбора
      this.#setState('connecting')
      this.#log('Подключаюсь…')
      const ok = await this.#connect(true)
      if (ok) this.#startReconnectLoop()
      else if (!this.ultra.isConnected()) this.#setState('unpaired')
      return
    }

    // уже сопряжён → переподключение делает фоновый цикл при пробуждении гаджета
    this.#setState('connecting')
    this.#log('Подключаюсь… если гаджет спит — нажми кнопку на нём.')
    this.#waitLogged = true
    this.#startReconnectLoop()
    void (async () => {
      await sleep(7000)
      if (!this.ultra.isConnected() && this.#state === 'connecting') {
        this.#setState('sleeping')
        this.#log('Пока не вижу гаджет. Нажми кнопку на нём и жми «Подключить».')
      }
    })()
  }

  // ---------- фоновое переподключение (без окна выбора) ----------
  #startReconnectLoop(): void {
    if (this.#loopRunning) return
    this.#loopRunning = true
    void (async () => {
      while (this.#active) {
        if (!this.ultra.isConnected() && !this.#paused && isPaired()) {
          if (!this.#waitLogged) {
            this.#log('⏳ Жду пробуждения гаджета (нажми кнопку на нём)…')
            this.#waitLogged = true
          }
          await this.#connect(false)
        }
        await sleep(LOOP_INTERVAL_MS)
      }
      this.#loopRunning = false
    })()
  }

  // ---------- сброс привязки (если устройство «залипло») ----------
  reset(): void {
    this.#active = false
    forgetDevice()
    this.#clearHold()
    this.#clearIdle()
    this.#setState('unpaired')
    this.#log('Устройство сброшено. Нажми «Подключить» и выбери его заново.')
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
    this.#waitLogged = false
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
        /* занято / старая прошивка — повтор */
      }
      await sleep(400)
    }
  }
}

export const chameleon = new ChameleonService()
