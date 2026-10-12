// Plain HTTP IP previews lack crypto.randomUUID; getRandomValues remains available.
// HTTPS and localhost keep the browser's native implementation.
if (!globalThis.crypto.randomUUID) {
  globalThis.crypto.randomUUID = () => {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
}
// Menus opened on pointerup can become the target of the following contextmenu event.
// Cancel the browser menu for the whole game without stopping its own right-click handlers.
document.addEventListener('contextmenu', (event) => event.preventDefault(), { capture: true });
await import('./app.js');
