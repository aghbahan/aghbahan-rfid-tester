import { useEffect, useState } from 'react'
import { chameleon, type ChSnapshot, type LogType } from '@/lib/chameleon'

export interface LogEntry {
  id: number
  time: string
  msg: string
  type: LogType
}

export function useChameleon() {
  const [snap, setSnap] = useState<ChSnapshot>(() => chameleon.snapshot())
  const [logs, setLogs] = useState<LogEntry[]>([])

  useEffect(() => {
    const unsub = chameleon.subscribe(setSnap)
    let n = 0
    const unlog = chameleon.onLog((msg, type) => {
      const time = new Date().toLocaleTimeString('ru-RU', { hour12: false })
      setLogs((prev) => [...prev.slice(-80), { id: n++, time, msg, type }])
    })
    return () => {
      unsub()
      unlog()
    }
  }, [])

  return { snap, logs, clearLogs: () => setLogs([]) }
}
