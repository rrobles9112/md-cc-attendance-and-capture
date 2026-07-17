/// <reference lib="webworker" />

const SYNC_TAG = 'sync-queue'
const IOS_POLL_INTERVAL = 30000

const sw = self as unknown as ServiceWorkerGlobalScope

sw.addEventListener('install', () => {
  sw.skipWaiting()
})

sw.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(sw.clients.claim())
})

sw.addEventListener('sync', (event: Event) => {
  const syncEvent = event as unknown as { tag: string; waitUntil: (p: Promise<void>) => void }
  if (syncEvent.tag === SYNC_TAG) {
    syncEvent.waitUntil(notifyClients('flush-sync'))
  }
})

function notifyClients(message: string): Promise<void> {
  return sw.clients.matchAll().then((clients) => {
    clients.forEach((client) => {
      client.postMessage({ type: message })
    })
  })
}

let iosPollInterval: ReturnType<typeof setInterval> | null = null

sw.addEventListener('message', (event: ExtendableMessageEvent) => {
  if (event.data?.type === 'start-ios-poll') {
    if (iosPollInterval) clearInterval(iosPollInterval)
    iosPollInterval = setInterval(() => {
      notifyClients('flush-sync')
    }, IOS_POLL_INTERVAL)
  }

  if (event.data?.type === 'stop-ios-poll') {
    if (iosPollInterval) {
      clearInterval(iosPollInterval)
      iosPollInterval = null
    }
  }

  if (event.data?.type === 'skip-waiting') {
    sw.skipWaiting()
  }
})
