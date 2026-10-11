# Шпаргалка: логика и команды (для полного приложения сборщика)

Это переиспользуемое ядро из тестера. Назначение — **авторизованное управление доступом**
коммунальной службы (эмуляция ключа обслуживаемого подъезда по договору и с согласия клиента;
см. `../README.md` → «Правовой контекст»).

## 1. Подключение (Web Bluetooth)

```js
import { Buffer, ChameleonUltra, Slot, TagType, FreqType, DeviceMode }
  from 'https://cdn.jsdelivr.net/npm/chameleon-ultra.js@0/+esm'
import WebbleAdapter from 'https://cdn.jsdelivr.net/npm/chameleon-ultra.js@0/plugin/WebbleAdapter/+esm'

const ultra = new ChameleonUltra()
ultra.use(new WebbleAdapter())      // ровно один адаптер на экземпляр

// ВАЖНО: connect() должен идти из обработчика клика (жест пользователя),
// иначе браузер не покажет окно выбора Bluetooth-устройства.
await ultra.connect()
ultra.isConnected()                 // boolean
await ultra.disconnect()
```

На десктопе есть ещё `WebserialAdapter` (USB) — то же API, другой транспорт.

## 2. Эмуляция одной EM410x-метки (125 кГц) по UID — ЯДРО

```js
const WORK_SLOT = Slot.SLOT_1                 // один слот переиспользуем под любую метку

await ultra.cmdChangeDeviceMode(DeviceMode.TAG)                      // режим эмуляции (не READER)
await ultra.slotChangeTagTypeAndActive(WORK_SLOT, null, TagType.EM410X) // слот → LF EM410x + активен
await ultra.cmdEm410xSetEmuId(Buffer.from('3600403CBA', 'hex'))     // UID = 5 байт (10 hex)
```

Всё. Устройство излучает эту метку (и только её), пока активен этот слот.
Чтобы сменить метку — снова вызвать те же 3 строки с другим UID. **Лимит 8 слотов не мешает:**
метки по слотам не раскладываем, всегда перезаписываем один.

Остановить: `await ultra.cmdSlotSetEnable(WORK_SLOT, FreqType.LF, false)`.

## 3. Формат UID

- **EM410x = 5 байт = 10 hex-символов** (напр. `3600403CBA`).
- Берётся из Flipper: строка `Hex` в `125 kHz RFID → Read` (внимание на последний байт:
  `BA`, а не `8A` — проверяется по `Card` = `0x3CBA` = 15546).
- Нормализация: убрать всё, кроме `0-9a-fA-F`, в верхний регистр, ровно 10 символов.

## 4. Полезные команды (сверх ядра)

| Задача | Метод |
|---|---|
| Активировать слот | `cmdSlotSetActive(slot)` |
| Сменить тип метки слота | `cmdSlotChangeTagType(slot, tagType)` |
| Тип + активация разом | `slotChangeTagTypeAndActive(slot, hfType, lfType)` |
| Вкл/выкл диапазон слота | `cmdSlotSetEnable(slot, FreqType.LF\|HF, bool)` |
| Записать EM410x UID (актив. слот) | `cmdEm410xSetEmuId(Buffer)` / прочитать: `cmdEm410xGetEmuId()` |
| Сохранить слоты в память | `cmdSlotSaveSettings()` |
| Режим TAG/READER | `cmdChangeDeviceMode(DeviceMode.TAG\|READER)` |

Полный API: https://taichunmin.idv.tw/chameleon-ultra.js/classes/index.ChameleonUltra.html

## 5. Как перейти от тестера к полному приложению

- **База вместо localStorage:** заменить `loadCards/saveCards` на запрос к Supabase
  (`service_points`: `address_en`, `chip_code`, `chip_type`). UID = `chip_code`.
  Приложение тянет список адресов маршрута, а UID пишет в Chameleon по кнопке.
- **Один коннект на маршрут:** держать BLE-соединение открытым, по тапу адреса — только
  3 строки из §2. Проверить поведение при блокировке экрана (эмуляция держится на самом
  устройстве и после разрыва BLE; телефон нужен лишь в момент смены метки).
- **13.56 МГц (MIFARE), на будущее:** для таких меток — `TagType.MIFARE_1024` и загрузка
  дампа (`cmdMf1*`), диапазон `FreqType.HF`. Нужен тип метки в данных (`chip_type`),
  чтобы знать, что и как излучать. Брендовые FNET/BOON — отдельный трек (серверная
  регистрация), не эмуляция.
- **Надёжность:** логировать на экран (как здесь), показывать активную метку, обрабатывать
  обрыв BLE (переподключение по кнопке — жест пользователя).

## 6. Среда / совместимость

- Chrome (Android/десктоп). iOS Web Bluetooth не поддерживает (у нас всё на Android).
- Нужен HTTPS или `localhost` (secure context).
- Для продакшена стоит зафиксировать версию `chameleon-ultra.js@<точная>` вместо `@0`.

## 7. Энергосбережение: сон и пробуждение (важно для маршрута)

- Батарея Chameleon Ultra ~90 мА·ч. В покое (сон) расход ~20–60 µА → **месяцы** работы.
- **BLE-соединение держит устройство активным** → быстрый разряд (часы–сутки). Это причина «всегда включён».
- В стоковой `chameleon-ultra.js` **нет команды «спать»**; сон наступает при **отключении BLE** (`ultra.disconnect()`) + бездействии.
- **Правильная схема для маршрута:** приложение по BLE только **записывает** нужный UID в слот и **активирует**, затем **отключает BLE** → устройство спит с этой меткой как активной. У двери оно **просыпается от поля** домофона и излучает активный слот. Телефон у двери подключённым быть **не обязан**.
- **Проверить на своём устройстве** (зависит от прошивки): спящий (BLE отключён) Chameleon сам просыпается от поля и открывает — или нужно нажать кнопку? Тест: записать метку → отключить BLE → поднести к двери без переподключения.
  - field-wake работает → схема «записал → отключился → спит → у двери излучает».
  - нужна кнопка → у двери короткое нажатие кнопки Chameleon будит + излучает активный слот.
- **Смена метки** нужна только при смене адреса (краткое BLE-подключение), не на каждое открытие: активный слот хранится в устройстве и во сне.
- **% батареи:** `await ultra.cmdGetBatteryInfo()` — показывать в приложении, предупреждать при низком.
- **Переподключение без окна выбора:** стоковый `WebbleAdapter` при каждом `connect()` вызывает chooser. Для полного приложения — хранить ссылку на `BluetoothDevice` и переподключаться через `device.gatt.connect()` (в пределах сессии без chooser) или `navigator.bluetooth.getDevices()`.

## 8. Типы меток: чтение на Flipper → админка → Chameleon

| Тип | Частота | Flipper: как прочитать | Chameleon эмулирует? | Админка: `chip_type` / `chip_code` |
|---|---|---|---|---|
| EM-Marine (EM4100) | 125 кГц LF | `125 kHz RFID → Read` → строка **Hex** (5 байт) | ✅ да (наш случай) | `EM410X` / 10 hex |
| HID Prox | 125 кГц LF | `125 kHz RFID → Read` (HID, FC/Card) | ✅ да | `HIDProx` / код Flipper |
| MIFARE Classic 1K/4K | 13.56 МГц HF | `NFC → Read` (UID; полный — ключи/дамп) | ⚠️ да, но часто нужен **дамп**, не только UID | `MIFARE_1K` / UID (+дамп) |
| MIFARE Ultralight/NTAG | 13.56 МГц HF | `NFC → Read` | ✅ да | `NTAG`/`UL` / UID (+страницы) |
| iButton / Dallas | контакт 1-Wire | `iButton → Read` (8 байт) | ❌ **нет** (контактные не поддерживаются) | `iButton` — нужен Flipper/физ. клон RW1990 |
| Cyfral / Metakom | контакт | `iButton → Read` | ❌ нет | `Cyfral`/`Metakom` — не через Chameleon |

Правила:
- **`chip_type` хранить обязательно** (не только код) — приложение по типу выбирает способ эмуляции.
- Chameleon = только **бесконтактные** (125 кГц + 13.56 МГц). **Контактные «таблетки» (iButton/Cyfral/Metakom) Chameleon не умеет** — приложение должно это показывать, а не молчать (для них: Flipper-эмуляция или физический дубликат RW1990).
- MIFARE «по UID» срабатывает, если считыватель проверяет только UID; брендовые FNET/BOON — серверная регистрация → клон не сработает (отдельный трек).
- Команды эмуляции по типам:
  - **EM410X:** `slotChangeTagTypeAndActive(slot, null, TagType.EM410X)` + `cmdEm410xSetEmuId(Buffer 5 байт)`.
  - **MIFARE:** тип `TagType.MIFARE_1024`; UID → `cmdHf14aSetAntiCollData(...)`; дамп → `cmdMf1WriteEmuBlockData(...)`; диапазон HF.
