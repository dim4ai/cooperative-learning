// Our own line icons, 24×24, stroke = currentColor.

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

export const icons = {
  select: svg('<path d="M6 3l12 9-5.5 1.2L15 19l-2.4 1.1-2.5-5.8L6 18z"/>'),
  hand: svg('<path d="M8 12V6.5a1.5 1.5 0 013 0V11m0-5.5V4.5a1.5 1.5 0 013 0V11m0-4.5a1.5 1.5 0 013 0V14a6 6 0 01-6 6h-1a6 6 0 01-5-2.7L3.6 14a1.5 1.5 0 012.5-1.7L8 14.5"/>'),
  pen: svg('<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19z"/><path d="M14.5 6.5l3 3"/>'),
  marker: svg('<path d="M9 15l-2.5 2.5V20h4l2.5-2.5"/><path d="M9 15l7.5-10.5a2 2 0 013 2L13 17.5z"/><path d="M4 21h16" opacity=".5"/>'),
  eraser: svg('<path d="M8 20h12"/><path d="M4.6 15.4l9.8-9.8a2 2 0 012.8 0l2.2 2.2a2 2 0 010 2.8L11 19H8z"/><path d="M9 11l5 5"/>'),
  broom: svg('<path d="M20 4l-7.5 7.5"/><path d="M12.5 11.5l-3-1-6 6.5 4 4 6.5-6z"/><path d="M6 15.5l1.5 1.5M8.5 13l2.5 2.5"/>'),
  line: svg('<path d="M5 19L19 5"/>'),
  arrow: svg('<path d="M5 19L19 5"/><path d="M10 5h9v9"/>'),
  rect: svg('<rect x="4" y="6" width="16" height="12" rx="1"/>'),
  ellipse: svg('<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>'),
  triangle: svg('<path d="M12 4.5L20.5 19h-17z"/>'),
  text: svg('<path d="M5 6V4.5h14V6"/><path d="M12 4.5v15"/><path d="M9 19.5h6"/>'),
  image: svg('<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 16l-5-5-8.5 8"/>'),
  undo: svg('<path d="M9 7L4.5 11.5 9 16"/><path d="M5 11.5h9.5a5 5 0 010 10H11"/>'),
  zoomIn: svg('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4M8.5 11h5M11 8.5v5"/>'),
  zoomOut: svg('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4M8.5 11h5"/>'),
  mic: svg('<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0013 0M12 18v2.5"/>'),
  micOff: svg('<path d="M15 10V6.5a3 3 0 00-5.6-1.5M9 9v2.5a3 3 0 004.6 2.5"/><path d="M5.5 11.5a6.5 6.5 0 0010.8 4.9M18.5 11.5a6.4 6.4 0 01-.4 2.2M12 18v2.5M4 4l16 16"/>'),
  cam: svg('<rect x="3" y="6.5" width="12.5" height="11" rx="2"/><path d="M15.5 10.5l5-3v9l-5-3"/>'),
  camOff: svg('<path d="M9 6.5h4.5a2 2 0 012 2v4M15.5 15.5a2 2 0 01-2 2H5a2 2 0 01-2-2v-7a2 2 0 011.5-1.9M15.5 10.5l5-3v9l-3-1.8M3 3l18 18"/>'),
  link: svg('<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>'),
  leave: svg('<path d="M14 4.5h4a1.5 1.5 0 011.5 1.5v12a1.5 1.5 0 01-1.5 1.5h-4"/><path d="M10 16l-4-4 4-4M6 12h9"/>'),
}
