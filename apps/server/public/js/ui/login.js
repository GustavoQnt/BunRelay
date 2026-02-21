import { els } from "./elements.js";
import { initials } from "../util/format.js";

export function showLoginError(message) {
  els.loginError.textContent = message;
  els.loginError.classList.remove("hidden");
}

export function clearLoginError() {
  els.loginError.textContent = "";
  els.loginError.classList.add("hidden");
}

export function setLoginBusy(isBusy) {
  els.loginBtn.disabled = isBusy;
  els.loginBtn.textContent = isBusy ? "Entrando..." : "Entrar";
}

export function showApp(user) {
  els.loginOverlay.classList.add("hidden");
  els.app.hidden = false;
  els.userName.textContent = user.displayName || user.username || user.id;
  els.userAvatar.textContent = initials(user.id || user.username || "u");
  els.userStatus.textContent = "online";
}

export function showLogin() {
  els.app.hidden = true;
  els.loginOverlay.classList.remove("hidden");
}
 