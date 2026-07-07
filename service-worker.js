const CACHE_NAME = "stockflow v3.0";
const BASE_PATH =
  self.location.pathname.replace(/\/service-worker\.js$/, "") || "";
const withBase = (path) => {
  if (!path.startsWith("/")) return path;
  return `${BASE_PATH}${path}`;
};
/* =========================
   CORE OFFLINE FILES 
========================= */
const CORE_ASSETS = [
  "/",
  "/index.html",
  "/products.html",
  "/purchases.html",
  "/stats.html",
  "/finances.html",
  "/expenses.html",
  "/debts.html",
  "/losses.html",
  "/expensess.html",
  "/pages.html",
  "/login.html",
  "/signup.html",
  "/help.html",
  "/manifest.json",
  "/logo.png",
  "/home.png",
  "/settings.html",
  "/ranging.html",
  "/loader.html",
  "/vendus.html",

  "/js/index.js",
  "/js/ui.js",
  "/js/nav.js",
  "/js/pwa.js",
  "/js/appConfig.js",
  "/js/receipt.js",
   "/js/offline.js",
  "/js/products.js",
  "/js/purchases.js",
  "/js/stats.js",
  "/js/render.js",
  "/js/expiration.js",
  "/css/finances.css",
  "/js/finances.js",
  "/js/expenses.js",
  "/js/debts.js",
  "/js/losses.js",
  "/js/finance/collections.js",
  "/js/finance/data.js",
  "/js/finance/shared.js",
  "/js/finance/notifications.js",
  "/js/finance/toast.js",
  "/js/help.js",
  "/js/help/help-tutoriel.js",
  "/js/pages.js",
  "/js/login.js",
  "/js/signup.js",
  "/js/auth-flow.js",
  "/js/password-toggle.js",
  "/js/auth.js",
  "/js/settings.js",
  "/js/ranging.js",
  "/js/loader.js",
  "/js/vendus.js",
  "/js/filter.js",
  "/js/chart.js",
  "/js/download.js",
  "/js/firebase.js"
].map(withBase);

/* =========================
   INSTALL
========================= */

self.addEventListener(
  "install",
  (event) => {

    event.waitUntil(

      caches.open(CACHE_NAME)
        .then(async (cache) => {

          for (const asset of CORE_ASSETS) {

            try {
              await cache.add(asset);
              console.log(
                "✅ Cached:",
                asset
              );

            } catch (err) {
              console.error(
                "❌ Cache failed:",
                asset,
                err
              );
            }
          }
        })
    );
    self.skipWaiting();
  }
);

/* =========================
   ACTIVATE
========================= */

self.addEventListener(
  "activate",
  (event) => {
    event.waitUntil(
      caches.keys()
        .then((keys) => {
          return Promise.all(
            keys
              .filter(
                (key) =>
                  key !== CACHE_NAME
              )
              .map(
                (key) =>
                  caches.delete(key)
              )
          );
        })
    );
    self.clients.claim();
  }
);

/* =========================
   NOTIFICATIONS
========================= */

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clients => {
      const target = clients.find(c =>
        c.url.includes("debts.html") || c.url.includes("finances.html")
      );
      if (target) {
        return target.focus();
      }
      return self.clients.openWindow(withBase("/debts.html"));
    })
  );
});

/* =========================
   FETCH
========================= */

self.addEventListener(
  "fetch",
  (event) => {

    const request =
      event.request;

    /* ---------- Ignore non-GET ---------- */
    if (
      request.method !== "GET"
    ) {
      return;
    }
    
    /* ---------- permit ---------- */   
    if (
  request.url.startsWith("https://www.gstatic.com") ||
  request.url.startsWith("https://esm.sh")
) {

  event.respondWith(
    caches.open(CACHE_NAME).then(async cache => {

      const cached = await cache.match(request);
      if (cached) {
        return cached;
      }

      try {
        const response = await fetch(request);
        cache.put(request, response.clone());
        return response;
      } catch {
        return cached;
      }
    })
  );
  return;
}

    /* ---------- Firebase ---------- */

    if (
      request.url.includes(
        "firebase"
      ) ||
      request.url.includes(
        "googleapis"
      )
    ) {

      event.respondWith(
        fetch(request)
          .catch(() => {
            return new Response(
              null,
              {
                status: 503,
                statusText:
                  "Offline"
              }
            );
          })
      );
      return;
    }

    /* ---------- Cache First ---------- */
    event.respondWith(
      caches.match(request)
        .then((cached) => {

          if (cached) {
            return cached;
          }
          return fetch(request)

            .then((response) => {
              if (
                !response ||
                !response.ok
              ) {
                return response;
              }

              const clone =
                response.clone();

              caches.open(
                CACHE_NAME
              )
              .then((cache) => {
                cache.put(
                  request,
                  clone
                );
              });
              return response;
            })
            .catch(async () => {

              const offlinePage =
                await caches.match(
                  withBase("/index.html")
                );
              return (
                offlinePage ||

                new Response(
                  "Offline",
                  {
                    status: 503,
                    headers: {
                      "Content-Type":
                        "text/plain"
                    }
                  }
                )
              );
            });
        })
    );
  }
);
