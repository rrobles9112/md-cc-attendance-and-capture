/* Service worker — BackgroundSync + iOS setInterval fallback.
 * Source of truth for types: src/workers/sw.ts
 */
const SYNC_TAG = 'sync-queue'
const IOS_POLL_INTERVAL = 30000

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(notifyClients('flush-sync'))
  }
})

function notifyClients(message) {
  return self.clients.matchAll().then((clients) => {
    clients.forEach((client) => {
      client.postMessage({ type: message })
    })
  })
}

let iosPollInterval = null

self.addEventListener('message', (event) => {
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
    self.skipWaiting()
  }
})
