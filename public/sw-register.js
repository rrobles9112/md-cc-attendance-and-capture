if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('/sw.js')
      .then(function(registration) {
        console.log('SW registered:', registration.scope);

        if ('sync' in registration) {
          registration.sync.register('sync-queue').catch(function() {
            // BackgroundSync not supported, iOS fallback will handle it
          });
        }
      })
      .catch(function(err) {
        console.log('SW registration failed:', err);
      });
  });
}
