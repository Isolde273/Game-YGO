// Solid silhouettes with cutouts share a single 24-unit construction grid.
const shapes = {
  box: '<path d="m12 2 10 5v12l-10 5L2 19V7Zm0 3L6 8l6 3 6-3Zm-7 5v7l5 3v-7Zm9 3v7l5-3v-7Z"/>',
  album: '<path d="M2 3h8l2 2 2-2h8v18h-8l-2 2-2-2H2Zm3 3v12h5V6Zm9 0v12h5V6Z"/>',
  warehouse: '<path d="m12 2 11 7v3h-2v10H3V12H1V9Zm-5 10v7h3v-7Zm7 0v7h3v-7Z"/>',
  organize:
    '<path d="M2 2h8v8H2Zm12 0h8v8h-8ZM2 14h8v8H2Zm12 0h8v8h-8ZM5 5v2h2V5Zm12 0v2h2V5ZM5 17v2h2v-2Zm12 0v2h2v-2Z"/>',
  shop: '<path d="M6 1h12l2 2v18l-2 2H6l-2-2V3Zm1 4v13h10V5Zm3 15v1h4v-1Z"/>',
  settings: '<path d="M2 5h20v3H2Zm0 11h20v3H2ZM6 2h4v9H6Zm8 11h4v9h-4Z"/>',
  arrow: '<path d="M2 10h13l-5-5 3-3 10 10-10 10-3-3 5-5H2Z"/>',
  back: '<path d="M22 10H9l5-5-3-3L1 12l10 10 3-3-5-5h13Z"/>',
  exit: '<path d="M1 2h9v3H4v16h6v3H1Z"/><circle cx="13" cy="5" r="2"/><path d="m12 8 4 1 3 4-2 2-3-3-1 4 4 5-2 2-5-6 1-5-3 3-2-2Zm7-2 5 4-5 4v-3h-3V9h3Z"/>',
  coin: '<image href="./public/assets/currency.webp" x="0" y="0" width="24" height="24" preserveAspectRatio="xMidYMid meet"/>',
  card: '<path d="M5 1h14l2 2v18l-2 2H5l-2-2V3Zm1 4v10h12V5Zm0 13v2h9v-2Z"/>',
  close: '<path d="m5 2 7 7 7-7 3 3-7 7 7 7-3 3-7-7-7 7-3-3 7-7-7-7Z"/>',
  sound: '<path d="M2 8h5l7-6v20l-7-6H2Zm15-3c5 4 5 10 0 14l-2-3c3-2 3-6 0-8Z"/>',
  star: '<path d="m12 1 3 7 8 1-6 5 2 9-7-5-7 5 2-9-6-5 8-1Z"/>',
  search:
    '<path d="M10 1a9 9 0 1 0 5 16l6 6 3-3-6-6A9 9 0 0 0 10 1Zm0 4a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z"/>',
  chat: '<path d="M2 2h20v15H10l-8 6Zm4 4v2h12V6Zm0 5v2h8v-2Z"/>',
  gift: '<path d="M3 3h7l2 3 2-3h7v5h2v5H1V8h2Zm3 3v2h4L9 6Zm9 0-1 2h4V6ZM3 15h7v8H3Zm11 0h7v8h-7Z"/>',
  expand: '<path d="M1 1h9v4H5v5H1Zm13 0h9v9h-4V5h-5ZM1 14h4v5h5v4H1Zm18 0h4v9h-9v-4h5Z"/>',
  check: '<path d="m1 12 4-4 5 5L20 2l4 4-14 16Z"/>',
  download: '<path d="M10 1h4v10h5l-7 8-7-8h5ZM2 18h4v3h12v-3h4v6H2Z"/>',
  clock:
    '<path d="M12 1a11 11 0 1 0 0 22 11 11 0 0 0 0-22Zm0 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14Zm-2 1v8h7v-3h-4V6Z"/>',
};
export const icon = (name, cls = '') =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd" aria-hidden="true">${shapes[name] ?? shapes.card}</svg>`;
