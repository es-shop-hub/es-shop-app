import {
  HELP_TUTORIALS,
  ES_COMPANY_ABOUT,
  STOCKFLOW_WHY,
  HELP_CONTACT
} from "./help/help-tutoriel.js";

function createTextEl(tag, text, className) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.textContent = text;
  return el;
}

function closeAllPanels(container) {
  container.querySelectorAll(".help-accordion-btn").forEach(btn => {
    btn.setAttribute("aria-expanded", "false");
    const icon = btn.querySelector(".help-accordion-icon");
    if (icon) {
      icon.textContent = "+";
      icon.classList.remove("is-open");
    }
  });

  container.querySelectorAll(".help-accordion-panel").forEach(panel => {
    panel.hidden = true;
  });
}

function openPanel(btn, panel, icon) {
  btn.setAttribute("aria-expanded", "true");
  icon.textContent = "−";
  icon.classList.add("is-open");
  panel.hidden = false;
}

function buildTutorialPanel(page) {
  const panel = document.createElement("div");
  panel.className = "help-accordion-panel";
  panel.id = `help-panel-${page.id}`;
  panel.hidden = true;

  const howTitle = createTextEl("h3", "Comment utiliser");
  const howP = createTextEl("p", page.howTo);

  const todoLabel = createTextEl("em", "Ce qu'il faut faire");
  todoLabel.className = "help-todo-label";
  const todoP = createTextEl("p", page.todo);
  todoP.className = "help-todo-text";

  const detailP = createTextEl("p", page.body);
  detailP.className = "help-body-text";

  const pageLink = document.createElement("a");
  pageLink.className = "help-page-link";
  pageLink.href = page.page;
  pageLink.textContent = `Ouvrir ${page.title} →`;

  panel.append(howTitle, howP, todoLabel, todoP, detailP, pageLink);
  return panel;
}

function buildAccordion(container) {
  container.replaceChildren();
  let lastSection = "";

  HELP_TUTORIALS.forEach((page) => {
    const sectionName = page.section || "";
    if (sectionName && sectionName !== lastSection) {
      lastSection = sectionName;
      const sectionTitle = createTextEl("h3", sectionName);
      sectionTitle.className = "help-section-group";
      container.appendChild(sectionTitle);
    }

    const item = document.createElement("article");
    item.className = "help-accordion-item";

    const header = document.createElement("div");
    header.className = "help-accordion-header";

    const title = createTextEl("h2", page.title);
    const role = createTextEl("p", page.role);
    role.className = "help-page-role";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "help-accordion-btn";
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-controls", `help-panel-${page.id}`);

    const btnLabel = createTextEl("span", "Voir le tutoriel");
    const icon = createTextEl("span", "+");
    icon.className = "help-accordion-icon";
    icon.setAttribute("aria-hidden", "true");

    btn.append(btnLabel, icon);

    const panel = buildTutorialPanel(page);

    btn.addEventListener("click", () => {
      const isOpen = btn.getAttribute("aria-expanded") === "true";
      closeAllPanels(container);

      if (!isOpen) {
        openPanel(btn, panel, icon);
      }
    });

    header.append(title, role, btn);
    item.append(header, panel);
    container.appendChild(item);
  });
}

function buildAboutSection() {
  const section = document.getElementById("helpAbout");
  if (!section) return;

  section.replaceChildren();

  const title = createTextEl("h2", "À propos de ES-Company");
  title.className = "help-section-title";

  const mission = createTextEl("p", ES_COMPANY_ABOUT.mission);
  const history = createTextEl("p", ES_COMPANY_ABOUT.history);
  const approach = createTextEl("p", ES_COMPANY_ABOUT.approach);
  approach.className = "help-highlight";

  const siteLink = document.createElement("a");
  siteLink.className = "help-site-link";
  siteLink.href = HELP_CONTACT.website;
  siteLink.target = "_blank";
  siteLink.rel = "noopener noreferrer";
  siteLink.textContent = "Visiter le site ES-Company →";

  section.append(title, mission, history, approach, siteLink);
}

function buildWhySection() {
  const section = document.getElementById("helpWhy");
  if (!section) return;

  section.replaceChildren();

  const title = createTextEl("h2", "Pourquoi StockFlow");
  title.className = "help-section-title";

  const intro = createTextEl(
    "p",
    "Comprenez le passage du chaos papier à une gestion maîtrisée."
  );

  const grid = document.createElement("div");
  grid.className = "help-why-grid";

  const colA = document.createElement("div");
  colA.className = "help-why-col help-why-a";
  colA.appendChild(createTextEl("h3", "Point A — Aujourd'hui"));
  const listA = document.createElement("ul");
  STOCKFLOW_WHY.pointA.forEach(text => {
    const li = document.createElement("li");
    li.textContent = text;
    listA.appendChild(li);
  });
  colA.appendChild(listA);

  const colB = document.createElement("div");
  colB.className = "help-why-col help-why-b";
  colB.appendChild(createTextEl("h3", "Point B — Avec StockFlow"));
  const listB = document.createElement("ul");
  STOCKFLOW_WHY.pointB.forEach(text => {
    const li = document.createElement("li");
    li.textContent = text;
    listB.appendChild(li);
  });
  colB.appendChild(listB);

  grid.append(colA, colB);

  const promise = createTextEl("p", STOCKFLOW_WHY.promise);
  promise.className = "help-promise";

  const central = createTextEl("blockquote", STOCKFLOW_WHY.centralMessage);
  central.className = "help-quote";

  section.append(title, intro, grid, promise, central);
}

document.addEventListener("DOMContentLoaded", () => {
  const accordion = document.getElementById("helpAccordion");
  if (accordion) {
    buildAccordion(accordion);
  }

  buildAboutSection();
  buildWhySection();
});
