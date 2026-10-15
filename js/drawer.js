/* Script classique (pas type=module) — fonctionne aussi en file:// */
(function (global) {
"use strict";

const DESKTOP_MQ = window.matchMedia("(min-width: 1024px)");
let drawerMqBound = false;
let drawerOutsideBound = false;
let drawerChromeRetries = 0;
const DRAWER_CHROME_MAX_RETRIES = 20;

function drawerEl(id) {
  return document.getElementById(id);
}

function getDrawerShell() {
  return {
    overlay: drawerEl("sfDrawerOverlay"),
    drawer: drawerEl("sfDrawer"),
    brand: drawerEl("sfDrawerBrand"),
    nav: drawerEl("sfDrawerNav"),
    adminNav: drawerEl("sfDrawerAdmin"),
    main: drawerEl("sfMain"),
    toggle: drawerEl("sfDrawerToggle")
  };
}

function getBasePath() {
  const parts = location.pathname.split("/").filter(Boolean);
  const parent = parts.length >= 2 ? parts[parts.length - 2] : "";
  const subdirs = new Set(["demandes", "batch", "billing-info"]);
  return subdirs.has(parent) ? "../" : "";
}

function resolveHref(href) {
  const base = getBasePath();
  if (!base) {
    return href;
  }
  return `${base}${href}`;
}

function isDrawerPathActive(href) {
  const target = String(href || "").replace(/^\//, "");
  const path = location.pathname.replace(/^\//, "");
  return path === target || path.endsWith(`/${target}`);
}

function refreshPublicDrawerLinks() {
  const shell = getDrawerShell();
  const nav = shell.nav;
  const brand = shell.brand;
  if (!nav || !nav.dataset.sfPublicReady) {
    return;
  }

  nav.querySelectorAll("a.drawer-item").forEach(link => {
    const rawHref = link.getAttribute("data-href") || link.getAttribute("href") || "";
    link.href = resolveHref(rawHref);
    const isActive = isDrawerPathActive(rawHref);
    link.classList.toggle("active", isActive);
    if (isActive) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });

  const hub = brand?.querySelector(".drawer-brand-link");
  if (hub) {
    hub.href = resolveHref("index.html");
  }
}

function setDrawerOpen(drawer, overlay, open) {
  if (!drawer) {
    return;
  }
  drawer.classList.toggle("open", open);
  drawer.setAttribute("aria-hidden", open ? "false" : "true");
  if (overlay) {
    overlay.classList.toggle("open", open);
  }
}

function closeDrawerMobile() {
  if (DESKTOP_MQ.matches) {
    return;
  }
  const shell = getDrawerShell();
  setDrawerOpen(shell.drawer, shell.overlay, false);
}

function applyResponsiveLayout(drawer, overlay) {
  if (!drawer) {
    return;
  }
  if (DESKTOP_MQ.matches) {
    setDrawerOpen(drawer, overlay, true);
    return;
  }
  setDrawerOpen(drawer, overlay, false);
}

function bindDrawerEvents(toggle, overlay, drawer) {
  if (!drawer) {
    return;
  }

  if (toggle && toggle.dataset.sfDrawerBound !== "1") {
    toggle.dataset.sfDrawerBound = "1";

    toggle.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      if (DESKTOP_MQ.matches) {
        return;
      }
      const willOpen = !drawer.classList.contains("open");
      setDrawerOpen(drawer, overlay, willOpen);
    });
  }

  if (overlay && overlay.dataset.sfOverlayBound !== "1") {
    overlay.dataset.sfOverlayBound = "1";
    overlay.addEventListener("click", () => {
      closeDrawerMobile();
    });
  }

  if (!drawerOutsideBound) {
    drawerOutsideBound = true;

    document.addEventListener(
      "click",
      event => {
        if (DESKTOP_MQ.matches) {
          return;
        }
        if (!drawer.classList.contains("open")) {
          return;
        }
        const target = event.target;
        if (!(target instanceof Node)) {
          return;
        }
        if (drawer.contains(target)) {
          return;
        }
        if (toggle && toggle.contains(target)) {
          return;
        }
        closeDrawerMobile();
      },
      true
    );

    document.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        closeDrawerMobile();
      }
    });
  }

  if (!drawerMqBound) {
    DESKTOP_MQ.addEventListener("change", () => {
      const shell = getDrawerShell();
      applyResponsiveLayout(shell.drawer, shell.overlay);
    });
    drawerMqBound = true;
  }
}

function initDrawerChrome() {
  const shell = getDrawerShell();
  const { drawer, toggle, overlay } = shell;

  if (!drawer) {
    return;
  }

  if (!toggle) {
    if (drawerChromeRetries < DRAWER_CHROME_MAX_RETRIES) {
      drawerChromeRetries += 1;
      requestAnimationFrame(initDrawerChrome);
    }
    return;
  }

  drawerChromeRetries = 0;
  refreshPublicDrawerLinks();
  bindDrawerEvents(toggle, overlay, drawer);
  applyResponsiveLayout(drawer, overlay);
}

function initDrawerNavigation() {
  initDrawerChrome();
}

global.initDrawerNavigation = initDrawerNavigation;
})(typeof window !== "undefined" ? window : globalThis);
