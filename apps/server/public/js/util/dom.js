export function $(id) {
  return document.getElementById(id);
}

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function clear(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

export function setHidden(node, hidden) {
  node.classList.toggle("hidden", hidden);
}
