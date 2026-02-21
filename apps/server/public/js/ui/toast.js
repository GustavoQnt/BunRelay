import { els } from "./elements.js";

export function showToast(message, type = "info", duration = 3200) {
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.textContent = message;
  els.toastContainer.appendChild(node);

  window.setTimeout(() => {
    node.style.opacity = "0";
    node.style.transform = "translateY(-6px)";
    node.style.transition = "opacity 140ms ease, transform 140ms ease";
    window.setTimeout(() => node.remove(), 180);
  }, duration);
}
