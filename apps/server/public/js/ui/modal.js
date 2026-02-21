import { els } from "./elements.js";
import { clear, el } from "../util/dom.js";

function closeModal() {
  clear(els.modalBackdrop);
  els.modalBackdrop.classList.add("hidden");
}

function buildScaffold(titleText) {
  clear(els.modalBackdrop);
  els.modalBackdrop.classList.remove("hidden");

  const modal = el("div", "modal");
  const title = el("div", "brand", titleText);
  title.style.fontSize = "18px";

  modal.appendChild(title);
  els.modalBackdrop.appendChild(modal);

  const onEscape = (evt) => {
    if (evt.key === "Escape") {
      closeModal();
      document.removeEventListener("keydown", onEscape);
    }
  };
  document.addEventListener("keydown", onEscape);

  els.modalBackdrop.onclick = (evt) => {
    if (evt.target === els.modalBackdrop) {
      closeModal();
    }
  };

  return modal;
}

function makeActions(confirmLabel, onConfirm) {
  const actions = el("div", "form-actions");
  const cancel = el("button", "btn", "Cancelar");
  cancel.type = "button";
  cancel.onclick = closeModal;

  const confirm = el("button", "btn brand", confirmLabel);
  confirm.type = "submit";

  actions.append(cancel, confirm);

  return { actions, confirm, onConfirm };
}

export function openDmModal(onSubmit) {
  const modal = buildScaffold("Novo DM");
  const form = el("form", "form-row");

  const note = el("div", "inline-note", "Informe username ou user_id do destinatario.");
  const inputLabel = el("label", "", "Usuario");
  const input = el("input");
  input.placeholder = "bob ou user_bob";
  input.required = true;

  const { actions } = makeActions("Criar DM", onSubmit);

  form.append(note, inputLabel, input, actions);
  form.onsubmit = async (evt) => {
    evt.preventDefault();
    await onSubmit({ peer: input.value.trim(), close: closeModal });
  };

  modal.appendChild(form);
  input.focus();
}

export function openGroupModal(onSubmit) {
  const modal = buildScaffold("Novo Grupo");
  const form = el("form", "form-row");

  const nameLabel = el("label", "", "Nome da sala");
  const nameInput = el("input");
  nameInput.placeholder = "Project Ops";
  nameInput.required = true;

  const membersLabel = el("label", "", "Membros (csv)");
  const membersInput = el("textarea");
  membersInput.rows = 3;
  membersInput.placeholder = "bob, carlos";
  membersInput.required = true;

  const note = el("div", "inline-note", "Voce sera owner automaticamente.");
  const { actions } = makeActions("Criar Grupo", onSubmit);

  form.append(nameLabel, nameInput, membersLabel, membersInput, note, actions);
  form.onsubmit = async (evt) => {
    evt.preventDefault();
    await onSubmit({
      name: nameInput.value.trim(),
      membersRaw: membersInput.value.trim(),
      close: closeModal
    });
  };

  modal.appendChild(form);
  nameInput.focus();
}

export function openConfirmModal({ title, message, confirmLabel = "Confirmar", onConfirm }) {
  const modal = buildScaffold(title);
  const form = el("form", "form-row");
  const text = el("div", "inline-note", message);
  const { actions } = makeActions(confirmLabel, onConfirm);

  form.append(text, actions);
  form.onsubmit = async (evt) => {
    evt.preventDefault();
    await onConfirm();
    closeModal();
  };

  modal.appendChild(form);
}

export { closeModal };
