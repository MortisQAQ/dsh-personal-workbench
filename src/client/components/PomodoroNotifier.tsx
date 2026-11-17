/**
 * 把"一段专注完成"接到工作台**已有的提示组件**上（而不是另起一套）。
 *
 * 两处复用：
 * 1. `pushToast` —— 工作台的右上角 toast（`components/Toast.tsx`），界面开着时即时可见；
 * 2. `sendSystemNotification` —— 已有的桌面通知能力（`notificationCapability.ts`），
 *    只在页面**不可见**时补发：那时 toast 是看不见的，系统通知才有意义。
 *
 * 它不拥有任何状态：完成事件来自 store 的 `subscribeCompletion`，组件只是订阅者。
 */
import { useEffect } from 'react'
import { subscribeCompletion } from '../services/pomodoroTimer.js'
import { readNotificationCtor, sendSystemNotification } from '../notificationCapability.js'
import type { ToastTone } from './Toast.js'

export interface PomodoroNotifierProps {
  /** 反馈域的 toast 推口（由装配层注入，避免本组件去 import 域 hook）。 */
  pushToast: (message: string, tone?: ToastTone) => void
}

export function PomodoroNotifier({ pushToast }: PomodoroNotifierProps): null {
  useEffect(() => subscribeCompletion((event) => {
    const minutes = Math.max(1, Math.round(event.durationSeconds / 60))
    pushToast(`专注 ${minutes} 分钟完成，该休息了（第 ${event.cycles} 个番茄）`, 'success')
    /**
     * 页面可见时 toast 已经够了；不可见时补一条系统通知。
     * 失败不抛：`sendSystemNotification` 返回 `{ ok, reason }`，这里只把原因留在控制台。
     */
    if (typeof document === 'undefined' || !document.hidden) return
    const sent = sendSystemNotification({
      NotificationCtor: readNotificationCtor(globalThis),
      title: '番茄钟：专注完成',
      body: `第 ${event.cycles} 个番茄 · ${minutes} 分钟。休息一下？`,
    })
    if (!sent.ok) console.info('[workbench] 番茄钟系统通知未发出：', sent.reason)
  }), [pushToast])
  return null
}
