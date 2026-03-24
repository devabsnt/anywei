/**
 * Background task toast notifications.
 * Shows a small persistent indicator in the bottom-right when background tasks are running.
 */
const toasts = new Map() // id -> element

export function showToast(id, text) {
  const container = document.getElementById('bg-toasts')
  if (!container) return

  let el = toasts.get(id)
  if (!el) {
    el = document.createElement('div')
    el.className = 'bg-toast'
    el.innerHTML = `<span class="bg-toast-dot"></span><span class="bg-toast-text"></span>`
    container.appendChild(el)
    toasts.set(id, el)
  }
  el.querySelector('.bg-toast-text').textContent = text
}

export function removeToast(id) {
  const el = toasts.get(id)
  if (el) { el.remove(); toasts.delete(id) }
}
