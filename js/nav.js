// NAV — shell drawer StockFlow (IDs sf*)
// Script classique (pas type=module) pour marcher aussi en file:// local
(function () {
"use strict";

const currentPage = location.pathname.split("/").pop() || "index.html";
const DRAWER_DESKTOP_MQ = window.matchMedia("(min-width: 1024px)");

const DRAWER_HUB_ITEM = {
  href: "index.html",
  title: "Shop",
  subtitle: "Espace de travail",
  icon: "◆"
};

const DRAWER_PUBLIC_VERSION = "4";

const DRAWER_PUBLIC_SECTIONS = [
  {
    title: "Vente",
    items: [
      { href: "index.html", label: "Vente rapide", icon: "🛒" },
      { href: "vendus.html", label: "Vendus", icon: "📋" },
      { href: "clients.html", label: "Clients", icon: "👥" }
    ]
  },
  {
    title: "Stock",
    items: [
      { href: "products.html", label: "Produits", icon: "📦" },
      { href: "purchases.html", label: "Achats", icon: "📥" },
      { href: "suppliers.html", label: "Fournisseurs", icon: "🚚" },
      { href: "demandes/demand_add.html", label: "Demande client", icon: "➕" },
      { href: "demandes/demand_stats.html", label: "Stats demandes", icon: "📊" }
    ]
  },
  {
    title: "Finances",
    items: [
      { href: "finances.html", label: "Hub finances", icon: "💰" },
      { href: "expenses.html", label: "Dépenses", icon: "💸" },
      { href: "debts.html", label: "Dettes", icon: "📑" },
      { href: "losses.html", label: "Pertes", icon: "📉" }
    ]
  },
  {
    title: "Pilotage",
    items: [
      { href: "pages.html", label: "Navigation", icon: "📂" },
      { href: "stats.html", label: "Statistiques", icon: "📊" },
      { href: "vendeurs.html", label: "Vendeurs", icon: "👤" },
      { href: "ranging.html", label: "Ranking", icon: "🏆" },
      { href: "loader.html", label: "Vue rapide", icon: "📩" }
    ]
  },
  {
    title: "Lots",
    items: [
      { href: "batch/batch_management.html", label: "Gestion lots", icon: "📦" },
      { href: "batch/batch_stats.html", label: "Stats lots", icon: "📈" }
    ]
  },
  {
    title: "Système",
    items: [
      { href: "settings.html", label: "Paramètres", icon: "⚙️" },
      { href: "help.html", label: "Aide", icon: "🤝" },
      { href: "billing-info/billing.html", label: "Quotas & sécurité", icon: "☁️" }
    ]
  }
];

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

function resolveAssetPath(relativePath) {
  const base = getBasePath();
  return base ? `${base}${relativePath}` : relativePath;
}

function resolveDrawerHref(href) {
  return resolveAssetPath(href);
}

function setDrawerOpenState(drawer, overlay, open) {
  if (!drawer) {
    return;
  }
  drawer.classList.toggle("open", open);
  drawer.setAttribute("aria-hidden", open ? "false" : "true");
  if (overlay) {
    overlay.classList.toggle("open", open);
  }
}

function bindDrawerToggleImmediate() {
  const shell = getDrawerShell();
  const { toggle, drawer, overlay } = shell;
  if (!drawer) {
    return;
  }

  if (toggle && toggle.dataset.sfDrawerBound !== "1") {
    toggle.dataset.sfDrawerBound = "1";

    toggle.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      if (DRAWER_DESKTOP_MQ.matches) {
        return;
      }
      setDrawerOpenState(drawer, overlay, !drawer.classList.contains("open"));
    });
  }

  if (overlay && overlay.dataset.sfOverlayBound !== "1") {
    overlay.dataset.sfOverlayBound = "1";
    overlay.addEventListener("click", () => {
      if (DRAWER_DESKTOP_MQ.matches) {
        return;
      }
      setDrawerOpenState(drawer, overlay, false);
    });
  }

  if (DRAWER_DESKTOP_MQ.matches) {
    setDrawerOpenState(drawer, overlay, true);
  }
}

function hasPrebuiltDrawerShell() {
  const shell = getDrawerShell();
  return Boolean(shell.drawer && shell.main);
}

function markAppShellReady() {
  document.body.classList.add("sf-app");
}

function createDrawerNode(tag, className, text) {
  const el = document.createElement(tag);
  if (className) {
    el.className = className;
  }
  if (text !== undefined && text !== null) {
    el.textContent = text;
  }
  return el;
}

function isDrawerItemActive(href) {
  const target = String(href || "").replace(/^\//, "");
  const path = location.pathname.replace(/^\//, "");
  return path === target || path.endsWith(`/${target}`);
}

function appendDrawerItemParts(node, item) {
  const icon = createDrawerNode("span", "drawer-item-icon");
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = item.icon || "•";

  const label = createDrawerNode("span", "drawer-item-label", item.label);
  const trail = createDrawerNode("span", "drawer-item-trail");
  trail.setAttribute("aria-hidden", "true");
  trail.textContent = "›";
  node.append(icon, label, trail);
}

function closeDrawerIfMobile() {
  if (DRAWER_DESKTOP_MQ.matches) {
    return;
  }
  const shell = getDrawerShell();
  setDrawerOpenState(shell.drawer, shell.overlay, false);
}

async function handleDrawerLogout() {
  const loginHref = resolveDrawerHref("login.html");
  try {
    localStorage.removeItem("userRole");
    localStorage.removeItem("userId");
  } catch (_) {
    /* ignore */
  }
  try {
    const authMod = await import(resolveAssetPath("js/auth.js"));
    if (authMod?.getAuth && authMod?.signOut) {
      await authMod.signOut(authMod.getAuth());
    }
  } catch (err) {
    console.warn("logout auth:", err);
  }
  window.location.replace(loginHref);
}

function createDrawerPublicItem(item) {
  const link = createDrawerNode("a", "drawer-item");
  link.setAttribute("data-href", item.href);
  link.href = resolveDrawerHref(item.href);

  if (isDrawerItemActive(item.href)) {
    link.classList.add("active");
    link.setAttribute("aria-current", "page");
  }

  link.addEventListener("click", () => {
    closeDrawerIfMobile();
  });

  appendDrawerItemParts(link, item);
  return link;
}

function createDrawerLogoutButton() {
  const btn = createDrawerNode("button", "drawer-item drawer-logout");
  btn.type = "button";
  btn.id = "sfDrawerLogout";
  btn.setAttribute("data-action", "logout");
  appendDrawerItemParts(btn, {
    label: "Se déconnecter",
    icon: "🚪"
  });
  btn.addEventListener("click", () => {
    if (!window.confirm("Se déconnecter ?")) {
      return;
    }
    closeDrawerIfMobile();
    handleDrawerLogout();
  });
  return btn;
}

function ensureDrawerFooter(dock) {
  if (!dock) {
    return null;
  }
  let footer = dock.querySelector(":scope > #sfDrawerFooter");
  if (footer) {
    return footer;
  }
  footer = createDrawerNode("div", "drawer-footer");
  footer.id = "sfDrawerFooter";
  dock.appendChild(footer);
  return footer;
}

function renderDrawerLogoutFooter(dock) {
  const footer = ensureDrawerFooter(dock);
  if (!footer) {
    return;
  }
  if (footer.dataset.sfLogoutReady === DRAWER_PUBLIC_VERSION) {
    return;
  }
  footer.replaceChildren(createDrawerLogoutButton());
  footer.dataset.sfLogoutReady = DRAWER_PUBLIC_VERSION;
}

function ensureDrawerDock(drawer) {
  if (!drawer) {
    return null;
  }
  let dock = drawer.querySelector(":scope > .drawer-dock");
  if (dock) {
    ensureDrawerFooter(dock);
    return dock;
  }
  const brand = drawer.querySelector(".drawer-brand");
  const scroll = drawer.querySelector(".drawer-scroll");
  const footer = drawer.querySelector("#sfDrawerFooter");
  dock = createDrawerNode("div", "drawer-dock");
  if (brand) {
    dock.appendChild(brand);
  }
  if (scroll) {
    dock.appendChild(scroll);
  }
  if (footer) {
    dock.appendChild(footer);
  } else {
    ensureDrawerFooter(dock);
  }
  drawer.replaceChildren(dock);
  return dock;
}

function ensureDrawerDomShell() {
  const shell = getDrawerShell();
  const drawer = shell.drawer;
  if (!drawer) {
    return null;
  }

  let brand = shell.brand;
  let scroll = drawer.querySelector(".drawer-scroll");
  let nav = shell.nav;
  let adminNav = shell.adminNav;

  if (brand && scroll && nav && adminNav) {
    const dock = ensureDrawerDock(drawer);
    return { brand, nav, dock };
  }

  drawer.replaceChildren();

  const dock = createDrawerNode("div", "drawer-dock");

  brand = createDrawerNode("div", "drawer-brand");
  brand.id = "sfDrawerBrand";

  const scrollEl = createDrawerNode("div", "drawer-scroll");
  nav = createDrawerNode("nav", "drawer-nav");
  nav.id = "sfDrawerNav";
  nav.setAttribute("aria-label", "Navigation principale");

  adminNav = createDrawerNode("nav", "drawer-admin-slot");
  adminNav.id = "sfDrawerAdmin";
  adminNav.setAttribute("aria-label", "Administration");

  scrollEl.append(nav, adminNav);
  dock.append(brand, scrollEl);
  ensureDrawerFooter(dock);
  drawer.appendChild(dock);

  return { brand, nav, dock };
}

function renderDrawerPublicShell() {
  const shell = ensureDrawerDomShell();
  if (!shell) {
    return;
  }

  if (shell.brand.dataset.sfPublicReady !== "1") {
    shell.brand.replaceChildren();

    const hubLink = createDrawerNode("a", "drawer-brand-link");
    hubLink.href = resolveDrawerHref(DRAWER_HUB_ITEM.href);

    const hubIcon = createDrawerNode("span", "drawer-brand-icon");
    hubIcon.setAttribute("aria-hidden", "true");
    hubIcon.textContent = DRAWER_HUB_ITEM.icon;

    const title = createDrawerNode(
      "span",
      "drawer-brand-title",
      DRAWER_HUB_ITEM.title
    );
    title.setAttribute("data-shop-brand", "");

    hubLink.append(
      hubIcon,
      title,
      createDrawerNode("span", "drawer-brand-subtitle", DRAWER_HUB_ITEM.subtitle)
    );

    shell.brand.appendChild(hubLink);
    shell.brand.dataset.sfPublicReady = "1";
  }

  const dock =
    shell.dock ||
    (shell.brand && shell.brand.closest
      ? shell.brand.closest(".drawer-dock")
      : null);

  if (shell.nav.dataset.sfPublicReady === DRAWER_PUBLIC_VERSION) {
    renderDrawerLogoutFooter(dock);
    return;
  }

  shell.nav.replaceChildren();
  const fragment = document.createDocumentFragment();

  DRAWER_PUBLIC_SECTIONS.forEach((section, sectionIndex) => {
    if (sectionIndex > 0) {
      fragment.appendChild(createDrawerNode("hr", "drawer-divider"));
    }

    const sectionWrap = createDrawerNode("div", "drawer-section");
    sectionWrap.appendChild(
      createDrawerNode("div", "drawer-section-title", section.title)
    );

    (section.items || []).forEach(item => {
      sectionWrap.appendChild(createDrawerPublicItem(item));
    });

    fragment.appendChild(sectionWrap);
  });

  shell.nav.appendChild(fragment);
  shell.nav.dataset.sfPublicReady = DRAWER_PUBLIC_VERSION;
  renderDrawerLogoutFooter(dock);
}

function ensureDrawerCriticalStyles() {
  if (document.querySelector('link[data-sf-drawer-critical="1"]')) {
    return;
  }
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = resolveAssetPath("css/drawer-critical.css");
  link.dataset.sfDrawerCritical = "1";
  document.head.appendChild(link);
}

function ensureDrawerStyles() {
  ensureDrawerCriticalStyles();
  if (document.querySelector('link[data-sf-drawer-css="1"]')) {
    return;
  }
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = resolveAssetPath("css/drawer.css");
  link.dataset.sfDrawerCss = "1";
  document.head.appendChild(link);
}

function ensureOverlayForShell(shell) {
  if (shell.overlay || !shell.drawer) {
    return shell.overlay;
  }
  const overlay = document.createElement("div");
  overlay.id = "sfDrawerOverlay";
  document.body.insertBefore(overlay, shell.drawer);
  return overlay;
}

function ensureHeaderToggle(header) {
  if (!header) {
    return null;
  }
  const existing = getDrawerShell().toggle;
  if (existing) {
    return existing;
  }
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.id = "sfDrawerToggle";
  toggle.setAttribute("aria-label", "Ouvrir le menu");
  toggle.textContent = "☰";
  header.insertBefore(toggle, header.firstChild);
  return toggle;
}

function ensurePageHeader(main) {
  if (!main) {
    return null;
  }
  let header = main.querySelector("header");
  if (!header) {
    header = document.createElement("header");
    header.id = "sfAppHeader";
    const title = createDrawerNode("h1", "sf-page-title", DRAWER_HUB_ITEM.title);
    title.setAttribute("data-shop-brand", "");
    header.appendChild(title);
    main.insertBefore(header, main.firstChild);
  }
  return ensureHeaderToggle(header);
}

function ensureAppShell() {
  ensureDrawerStyles();
  const shell = getDrawerShell();

  if (hasPrebuiltDrawerShell()) {
    markAppShellReady();
    ensureOverlayForShell(shell);
    ensureDrawerDock(shell.drawer);
    ensurePageHeader(shell.main);
    renderDrawerPublicShell();
    bindDrawerToggleImmediate();
    return;
  }

  let overlay = shell.overlay;
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "sfDrawerOverlay";
    document.body.appendChild(overlay);
  }

  let drawer = shell.drawer;
  if (!drawer) {
    drawer = document.createElement("aside");
    drawer.id = "sfDrawer";
    drawer.setAttribute("aria-hidden", "true");

    const dock = document.createElement("div");
    dock.className = "drawer-dock";

    const brand = document.createElement("div");
    brand.id = "sfDrawerBrand";
    brand.className = "drawer-brand";

    const scroll = document.createElement("div");
    scroll.className = "drawer-scroll";

    const nav = document.createElement("nav");
    nav.id = "sfDrawerNav";
    nav.className = "drawer-nav";
    nav.setAttribute("aria-label", "Navigation principale");

    const adminNav = document.createElement("nav");
    adminNav.id = "sfDrawerAdmin";
    adminNav.className = "drawer-admin-slot";
    adminNav.setAttribute("aria-label", "Administration");

    scroll.append(nav, adminNav);
    dock.append(brand, scroll);
    ensureDrawerFooter(dock);
    drawer.appendChild(dock);
    document.body.appendChild(drawer);
  } else {
    ensureDrawerDock(drawer);
  }

  let main = getDrawerShell().main;
  if (!main) {
    main = document.createElement("div");
    main.id = "sfMain";
    const movable = [];
    Array.from(document.body.childNodes).forEach(node => {
      if (node === overlay || node === drawer) {
        return;
      }
      movable.push(node);
    });
    document.body.appendChild(main);
    movable.forEach(node => main.appendChild(node));
  }

  markAppShellReady();
  ensurePageHeader(main);
  renderDrawerPublicShell();
  bindDrawerToggleImmediate();
}

function applyShopBrand(shopName) {
  const name = String(shopName || "").trim() || "Shop";

  document.querySelectorAll("[data-shop-brand]").forEach(el => {
    el.textContent = name;
  });

  const brandTitle = document.querySelector(
    "#sfDrawerBrand .drawer-brand-title"
  );
  if (brandTitle) {
    brandTitle.textContent = name;
  }

  document
    .querySelectorAll(
      "header h1, header h2, header h3, #sfAppHeader h1, .header h1, .header h2, .header h3"
    )
    .forEach(el => {
      if (el.hasAttribute("data-shop-brand")) {
        el.textContent = name;
        return;
      }
      const t = (el.textContent || "").trim();
      if (!t) return;
      if (/^StockFlow\+?$/i.test(t) || /^Shop$/i.test(t)) {
        el.setAttribute("data-shop-brand", "");
        el.textContent = name;
        return;
      }
      if (/StockFlow\+?/i.test(t)) {
        el.textContent = t.replace(/StockFlow\+?/gi, name);
      }
    });

  const rawTitle = document.title || "";
  let pagePart = "";
  if (rawTitle.includes(" - ") || rawTitle.includes(" — ")) {
    pagePart = rawTitle.split(/\s+[—–-]\s+/).slice(1).join(" - ").trim();
  } else {
    pagePart = rawTitle
      .replace(/^StockFlow\+?\s*-?\s*/i, "")
      .replace(/^Shop\s*-?\s*/i, "")
      .trim();
  }
  if (pagePart && pagePart.toLowerCase() !== name.toLowerCase()) {
    document.title = `${name} - ${pagePart}`;
  } else {
    document.title = name;
  }
}

async function loadAndApplyShopBrand() {
  try {
    const { getShopName } = await import(resolveAssetPath("js/appConfig.js"));
    const shopName = await getShopName();
    applyShopBrand(shopName);
  } catch (err) {
    console.warn("shopName:", err);
    applyShopBrand("Shop");
  }
}

async function bootAppNavigation() {
  ensureAppShell();
  bindDrawerToggleImmediate();
  await loadAndApplyShopBrand();

  if (typeof window.initDrawerNavigation === "function") {
    window.initDrawerNavigation();
  }

  window.dispatchEvent(new CustomEvent("sf:drawer-shell-ready"));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    bootAppNavigation();
  });
} else {
  bootAppNavigation();
}

})();
