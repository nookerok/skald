export function makeNode(tag, options = {}) {
  const element = document.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.text !== undefined && options.text !== null) element.textContent = String(options.text);
  for (const [name, value] of Object.entries(options.attrs || {})) {
    if (value !== undefined && value !== null) element.setAttribute(name, String(value));
  }
  return element;
}
export function byId(id) { return document.getElementById(id); }
export function emptyState(text, className = "empty-state") { return makeNode("p", { className, text }); }
