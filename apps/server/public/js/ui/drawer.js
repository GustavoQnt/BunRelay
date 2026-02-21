import { els } from "./elements.js";
import { clear, el, setHidden } from "../util/dom.js";
import { displayName, formatDateTime } from "../util/format.js";

function memberRole(member) {
  return member.role || "member";
}

function addActionButton(container, action, label, userId) {
  const button = el("button", "btn", label);
  button.type = "button";
  button.dataset.action = action;
  button.dataset.userId = userId;
  container.appendChild(button);
}

export function renderDrawer(state) {
  els.drawer.classList.toggle("open", state.drawer.open);
  const isMembers = state.drawer.tab === "members";

  els.tabMembers.classList.toggle("active", isMembers);
  els.tabAudit.classList.toggle("active", !isMembers);
  setHidden(els.membersPanel, !isMembers);
  setHidden(els.auditPanel, isMembers);
}

export function renderMembers(state) {
  clear(els.membersList);
  const room = state.rooms.get(state.activeRoomId);
  if (!room) {
    const empty = el("div", "muted", "Nenhuma sala ativa");
    els.membersList.appendChild(empty);
    return;
  }

  const members = [...room.members].sort((a, b) => {
    const order = { owner: 0, admin: 1, member: 2 };
    const ar = order[memberRole(a)] ?? 3;
    const br = order[memberRole(b)] ?? 3;
    if (ar !== br) return ar - br;
    return displayName(a.userId).localeCompare(displayName(b.userId));
  });

  if (members.length === 0) {
    els.membersList.appendChild(el("div", "muted", "Sem membros carregados"));
    return;
  }

  for (const member of members) {
    const row = el("div", "member-row");

    const head = el("div", "member-head");
    const title = el(
      "div",
      "",
      member.userId === state.auth.user?.id ? `${displayName(member.userId)} (voce)` : displayName(member.userId)
    );
    const role = memberRole(member);
    const badge = el("span", `member-role ${role}`, role);
    head.append(title, badge);

    const meta = el("div", "audit-meta");
    const presence = state.presence.get(member.userId);
    meta.textContent = presence?.status === "online" ? "online" : "offline";

    const actions = el("div", "member-actions");
    const me = member.userId === state.auth.user?.id;

    if (!me) {
      if (role !== "owner") {
        if (role === "admin") {
          addActionButton(actions, "demote", "Rebaixar", member.userId);
        } else {
          addActionButton(actions, "promote", "Promover", member.userId);
        }
      }
      addActionButton(actions, "remove", "Remover", member.userId);
      addActionButton(actions, "transfer", "Owner", member.userId);
    }

    row.append(head, meta);
    if (actions.childElementCount > 0 && room.type === "group") {
      row.appendChild(actions);
    }

    els.membersList.appendChild(row);
  }
}

export function renderAudit(state) {
  clear(els.auditList);

  if (state.drawer.auditError) {
    els.auditList.appendChild(el("div", "login-error", state.drawer.auditError));
  }

  if (state.drawer.auditEntries.length === 0) {
    els.auditList.appendChild(el("div", "muted", state.drawer.auditLoading ? "Carregando..." : "Sem entradas"));
  } else {
    for (const entry of state.drawer.auditEntries) {
      const row = el("div", "audit-row");
      const title = el("div", "audit-title", entry.action);
      const meta = el(
        "div",
        "audit-meta",
        `${displayName(entry.actorUserId)} -> ${entry.targetUserId ? displayName(entry.targetUserId) : "-"}`
      );
      const time = el("div", "audit-meta", formatDateTime(entry.ts));
      row.append(title, meta, time);
      els.auditList.appendChild(row);
    }
  }

  els.loadAuditBtn.disabled = !state.activeRoomId || state.drawer.auditLoading || !state.drawer.auditHasMore;
  els.loadAuditBtn.textContent = state.drawer.auditLoading
    ? "Carregando..."
    : state.drawer.auditHasMore
      ? "Carregar mais"
      : "Fim do historico";
}
