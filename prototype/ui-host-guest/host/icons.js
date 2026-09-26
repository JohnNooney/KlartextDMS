// SF Symbols–style line icons (1.6 stroke, round caps). PROTOTYPE ONLY.
const paths = {
  tray: '<path d="M3 13.5V18a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4.5M3 13.5 5.6 6.2A2 2 0 0 1 7.5 5h9a2 2 0 0 1 1.9 1.2l2.6 7.3M3 13.5h5l1.5 2.5h5l1.5-2.5h5"/>',
  folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6c.6 0 1.2.3 1.6.7L12 7h6.5A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>',
  folderPlus: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6c.6 0 1.2.3 1.6.7L12 7h6.5A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5zM12 10.5v6M9 13.5h6"/>',
  upload: '<path d="M12 15.5V4.5M7.5 9 12 4.5 16.5 9M4.5 14.5v3A2.5 2.5 0 0 0 7 20h10a2.5 2.5 0 0 0 2.5-2.5v-3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  chevronLeft: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  chevronRight: '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
  chevronDown: '<path d="M6 9.5 12 15.5l6-6"/>',
  ellipsis: '<circle cx="6" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18" cy="12" r="1.3" fill="currentColor"/>',
  xmark: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  sidebarRight: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M15 4.5v15"/>',
  sidebarLeft: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M9 4.5v15"/>',
  pencil: '<path d="M4.5 19.5l1-4L16 5a2.1 2.1 0 0 1 3 3L8.5 18.5z"/>',
  move: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.6c.6 0 1.2.3 1.6.7L12 7h6.5A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5zM9 13.5h6M12.5 11l2.5 2.5-2.5 2.5"/>',
  trash: '<path d="M4.5 6.5h15M9.5 6.5V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v1.5M6.5 6.5l.9 12a2 2 0 0 0 2 1.9h5.2a2 2 0 0 0 2-1.9l.9-12"/>',
  check: '<path d="M5.5 12.5 10 17l8.5-9.5"/>',
  checkCircle: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.2 11 14.7l4.5-5"/>',
  warning: '<path d="M10.3 4.6 3.2 17a2 2 0 0 0 1.7 3h14.2a2 2 0 0 0 1.7-3L13.7 4.6a2 2 0 0 0-3.4 0zM12 9.5v4M12 16.8v.2"/>',
  doc: '<path d="M6.5 3.5h7l4.5 4.5v11a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5zM13.5 3.5V8H18"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
};

export function icon(name, size = 18) {
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}

export function docThumb(size = 44) {
  return `<svg class="doc-thumb" width="${size}" height="${Math.round(size * 1.25)}" viewBox="0 0 40 50" fill="none" aria-hidden="true">
    <path d="M5 2.5h20l10 10V45a2.5 2.5 0 0 1-2.5 2.5h-25A2.5 2.5 0 0 1 5 45V5a2.5 2.5 0 0 1 2.5-2.5z" fill="#fff" stroke="#c7c7cc" stroke-width="1.5"/>
    <path d="M25 2.5v7.5a2.5 2.5 0 0 0 2.5 2.5H35" stroke="#c7c7cc" stroke-width="1.5"/>
    <rect x="1" y="27" width="22" height="11" rx="2.5" fill="#ff3b30"/>
    <text x="12" y="35.2" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="7.5" font-weight="700" fill="#fff">PDF</text>
  </svg>`;
}

export function folderThumb(size = 52) {
  return `<svg class="folder-thumb" width="${size}" height="${Math.round(size * 0.8)}" viewBox="0 0 52 42" fill="none" aria-hidden="true">
    <path d="M2 6a4 4 0 0 1 4-4h11.3a4 4 0 0 1 3 1.4L23 6.5h23a4 4 0 0 1 4 4V36a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4z" fill="#8ed1fc"/>
    <path d="M2 13a4 4 0 0 1 4-4h40a4 4 0 0 1 4 4v23a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4z" fill="#5ac8fa"/>
  </svg>`;
}
