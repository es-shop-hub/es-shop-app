/**
 * Contrôleur central anti double-clic pour boutons d'action.
 */

const LOCKED_CLASS = "btn-action-locked";
const busyButtons = new WeakSet();
let stylesInjected = false;

function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement("style");
  style.id = "button-manager-styles";
  style.textContent = `
    button.btn-action-locked,
    button.btn-action-locked:disabled {
      opacity: 0.55;
      cursor: not-allowed;
      pointer-events: none;
      filter: grayscale(0.35);
    }
  `;
  document.head.appendChild(style);
}

function isButtonLocked(button) {
  if (!button) return false;
  return busyButtons.has(button) || button.dataset.btnManagerLock === "true";
}

/**
 * Verrouille visuellement un bouton.
 * @param {HTMLButtonElement} button
 */
export function lockButton(button) {
  if (!button || isButtonLocked(button)) return;

  injectStyles();

  button.dataset.btnManagerWasDisabled = button.disabled ? "1" : "0";
  button.dataset.btnManagerLock = "true";
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.classList.add(LOCKED_CLASS);
  busyButtons.add(button);
}

/**
 * Déverrouille un bouton et restaure son état disabled d'origine.
 * @param {HTMLButtonElement} button
 */
export function unlockButton(button) {
  if (!button) return;

  const wasDisabled = button.dataset.btnManagerWasDisabled === "1";

  button.classList.remove(LOCKED_CLASS);
  button.removeAttribute("aria-busy");
  delete button.dataset.btnManagerLock;
  delete button.dataset.btnManagerWasDisabled;

  button.disabled = wasDisabled;
  busyButtons.delete(button);
}

/**
 * Exécute une action avec verrouillage du bouton jusqu'à la fin.
 * @param {HTMLButtonElement|null|undefined} button
 * @param {() => Promise<unknown>|unknown} handler
 * @returns {Promise<unknown|undefined>}
 */
export async function runWithButtonLock(button, handler) {
  if (button && isButtonLocked(button)) return;

  if (button) lockButton(button);

  try {
    return await handler();
  } finally {
    if (button) unlockButton(button);
  }
}

/**
 * Attache un listener click avec anti double-envoi.
 * @param {HTMLButtonElement|null|undefined} button
 * @param {(event: Event) => Promise<unknown>|unknown} handler
 */
export function bindActionButton(button, handler) {
  if (!button || typeof handler !== "function") return;

  button.addEventListener("click", (event) => {
    void runWithButtonLock(button, () => handler(event));
  });
}

/**
 * Attache un listener submit avec anti double-envoi sur le bouton submit.
 * @param {HTMLFormElement|null|undefined} form
 * @param {(event: SubmitEvent) => Promise<unknown>|unknown} handler
 * @param {HTMLButtonElement|null|undefined} [submitButton]
 */
export function bindFormAction(form, handler, submitButton = null) {
  if (!form || typeof handler !== "function") return;

  const btn =
    submitButton ||
    form.querySelector('button[type="submit"], input[type="submit"]');

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    if (btn && isButtonLocked(btn)) return;

    void runWithButtonLock(btn, () => handler(event));
  });
}
