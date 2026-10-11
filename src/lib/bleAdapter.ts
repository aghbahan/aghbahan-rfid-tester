/**
 * Кастомный Web Bluetooth адаптер для chameleon-ultra.js.
 * Основан на MIT-адаптере библиотеки, но:
 *  - ЗАПОМИНАЕТ устройство между отключениями → тихое переподключение без окна выбора;
 *  - tryRestoreDevice(): после перезагрузки возвращает ранее выданное устройство (getDevices);
 *  - gatt.connect() с таймаутом и ОТМЕНОЙ (disconnect), чтобы не зависало и не оставляло
 *    «висящих» подключений.
 * Ошибки не глушим в emitErr (чтобы не спамить) — пробрасываем, логирует сервис.
 */

const ULTRA_SERV_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
const ULTRA_RX_CHAR_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'
const ULTRA_TX_CHAR_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'

const BLE_SCAN_FILTERS: BluetoothLEScanFilter[] = [
  { name: 'ChameleonUltra' },
  { namePrefix: 'CU-' },
  { services: [ULTRA_SERV_UUID] },
]

const CONNECT_TIMEOUT_MS = 5000

let savedDevice: BluetoothDevice | null = null
let listenerAttached = false

export function isPaired(): boolean {
  return savedDevice !== null
}
export function forgetDevice(): void {
  try {
    if (savedDevice?.gatt?.connected) savedDevice.gatt.disconnect()
  } catch {
    /* ignore */
  }
  savedDevice = null
  listenerAttached = false
}

// Вернуть ранее выданное устройство без окна выбора (после перезагрузки). true = нашли.
export async function tryRestoreDevice(): Promise<boolean> {
  try {
    const bt: any = (globalThis as any)?.navigator?.bluetooth
    if (typeof bt?.getDevices !== 'function') return false
    const devs: BluetoothDevice[] = await bt.getDevices()
    const found = devs.find((d) => (d.name ?? '').toLowerCase().includes('chameleon'))
    if (found) {
      savedDevice = found
      return true
    }
  } catch {
    /* getDevices может быть недоступен */
  }
  return false
}

export default class ReconnectWebbleAdapter {
  name = 'adapter'
  #isOpen = false
  #Buffer: any = null
  #bluetooth: any
  #rxChar: BluetoothRemoteGATTCharacteristic | null = null
  #port: unknown = null

  constructor() {
    this.#bluetooth = (globalThis as any)?.navigator?.bluetooth
  }

  async install(context: { ultra: any; Buffer: any }): Promise<{ isSupported: () => boolean }> {
    const { ultra, Buffer } = context
    this.#Buffer = Buffer

    if (ultra.$adapter != null) await ultra.disconnect(new Error('adapter replaced')).catch(() => {})

    const supported: boolean = (await this.#bluetooth?.getAvailability?.()) ?? false
    const adapter = { isSupported: (): boolean => supported }

    const gattConnected = (): boolean => savedDevice?.gatt?.connected ?? false

    ultra.addHook('connect', async (_ctx: unknown, next: () => Promise<unknown>) => {
      if (ultra.$adapter !== adapter) return await next()

      if (!supported) throw new Error('Web Bluetooth не поддерживается (нужен Chrome на Android/ПК)')

      if (savedDevice === null) {
        // первое сопряжение — окно выбора (нужен жест пользователя)
        savedDevice = await this.#bluetooth.requestDevice({
          filters: BLE_SCAN_FILTERS,
          optionalServices: [ULTRA_SERV_UUID],
        })
      }
      if (savedDevice === null) throw new Error('устройство не выбрано')
      if (!listenerAttached) {
        savedDevice.addEventListener('gattserverdisconnected', () => {
          void ultra.disconnect(new Error('gattserverdisconnected')).catch(() => {})
        })
        listenerAttached = true
      }

      // подключение GATT с таймаутом + отменой (disconnect), чтобы не зависало
      if (!gattConnected()) {
        const gatt = savedDevice.gatt
        if (!gatt) throw new Error('у устройства нет GATT')
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([
            gatt.connect(),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => {
                try {
                  gatt.disconnect()
                } catch {
                  /* ignore */
                }
                reject(new Error('таймаут подключения'))
              }, CONNECT_TIMEOUT_MS)
            }),
          ])
        } catch {
          /* проверим статус ниже */
        } finally {
          if (timer) clearTimeout(timer)
        }
      }
      if (!gattConnected()) throw new Error('гаджет не отвечает — разбуди его кнопкой')

      const serv = await savedDevice.gatt!.getPrimaryService(ULTRA_SERV_UUID)
      const rxChar = await serv.getCharacteristic(ULTRA_RX_CHAR_UUID)
      const txChar = await serv.getCharacteristic(ULTRA_TX_CHAR_UUID)
      this.#rxChar = rxChar

      const TS = (globalThis as any).TransformStream
      const WS = (globalThis as any).WritableStream
      const txStream = new TS()
      const onNotify = async (event: any): Promise<void> => {
        const dv = event?.target?.value
        if (!ArrayBuffer.isView(dv)) return
        const writer = txStream.writable.getWriter()
        await writer.write(this.#Buffer.fromView(dv))
        writer.releaseLock()
      }
      txChar.addEventListener('characteristicvaluechanged', onNotify)
      await txChar.startNotifications()

      const self = this
      this.#port = {
        isOpen: (): boolean => self.#isOpen,
        readable: txStream.readable,
        writable: new WS({
          async write(chunk: any): Promise<void> {
            if (self.#rxChar === null) throw new Error('rxChar is null')
            for (const part of chunk.chunk(20)) {
              const b = new self.#Buffer(part.length)
              b.set(part)
              await self.#rxChar.writeValueWithoutResponse(b.buffer)
            }
          },
        }),
      }
      this.#isOpen = true
      ultra.port = this.#port
      return await next()
    })

    ultra.addHook('disconnect', async (_ctx: unknown, next: () => Promise<unknown>) => {
      if (ultra.$adapter !== adapter) return await next()
      await next().catch(() => {})
      this.#isOpen = false
      try {
        if (gattConnected()) savedDevice?.gatt?.disconnect()
      } catch {
        /* ignore */
      }
      this.#port = null
      this.#rxChar = null
      // savedDevice НЕ очищаем — нужно для тихого переподключения
    })

    return adapter
  }
}
