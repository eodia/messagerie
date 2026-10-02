/**
 * The widget's styles, inside its shadow root: the page's CSS cannot reach them, and they
 * reach nothing of the page.
 *
 * What the site chooses in its row of « Sites » arrives as custom properties and classes on
 * `.root`: its colour (`--accent`), its distances to the page's edges (`--x`, `--y`), its
 * font (`--font`: the page's own by default — a widget loads no font on someone else's
 * page), its corners (`.soft`, `.square`), its side (`.left`) and its theme (`.light`,
 * `.dark`; otherwise the visitor's system decides). The neutrals are basedb's zinc; violet
 * belongs to the AI alone.
 */

const DARK = `
  --ink: #f4f4f5;
  --ink-2: #c4c4c8;
  --muted: #a1a1aa;
  --line: #2e2e33;
  --surface: #18181b;
  --canvas: #111113;
  --bubble: #202024;
  --shadow: 0 32px 80px -24px rgb(0 0 0 / 0.7), 0 0 0 1px rgb(255 255 255 / 0.06);
`

export const STYLES = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }

.root {
  --accent: #2563eb;
  --accent-ink: #fff;
  --ai: #7c3aed;
  --ink: #18181b;
  --ink-2: #52525b;
  --muted: #71717a;
  --line: #e4e4e7;
  --surface: #ffffff;
  --canvas: #f6f6f7;
  --bubble: #ffffff;
  --shadow: 0 32px 80px -24px rgb(24 24 27 / 0.35), 0 8px 24px -12px rgb(24 24 27 / 0.18);
  --x: 20px;
  --y: 20px;
  --r-panel: 24px; --r-bubble: 20px; --r-tail: 6px; --r-pill: 999px; --r-field: 24px; --r-launcher: 50%;
  font-family: var(--font, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif);
  font-size: 14.5px;
  line-height: 1.5;
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
}
@media (prefers-color-scheme: dark) {
  .root:not(.light) {${DARK}}
}
.root.dark {${DARK}}
.root.soft { --r-panel: 16px; --r-bubble: 14px; --r-tail: 4px; --r-pill: 12px; --r-field: 14px; --r-launcher: 18px; }
.root.square { --r-panel: 6px; --r-bubble: 6px; --r-tail: 2px; --r-pill: 6px; --r-field: 6px; --r-launcher: 8px; }
button, textarea { font: inherit; color: inherit; }
button { cursor: pointer; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* ── The launcher ─────────────────────────────────────────────────────────────── */
.launcher {
  position: fixed; right: var(--x); bottom: var(--y); z-index: 2147483000;
  width: 60px; height: 60px; border-radius: var(--r-launcher); border: 0;
  background: var(--accent); color: var(--accent-ink);
  display: grid; place-items: center;
  box-shadow: 0 12px 28px -8px color-mix(in srgb, var(--accent) 55%, transparent), 0 2px 6px rgb(0 0 0 / 0.12);
  transition: transform .2s cubic-bezier(.2,.8,.2,1);
}
.launcher:hover { transform: translateY(-2px); }
.launcher:active { transform: scale(.96); }
.launcher .icon { position: absolute; display: grid; place-items: center; transition: transform .25s cubic-bezier(.2,.8,.2,1), opacity .2s; }
.launcher svg { width: 26px; height: 26px; }
.launcher .when-open { opacity: 0; transform: rotate(-90deg) scale(.6); }
.launcher.open .when-open { opacity: 1; transform: none; }
.launcher.open .when-closed { opacity: 0; transform: rotate(90deg) scale(.6); }
.root.left .launcher { right: auto; left: var(--x); }
/* A pill that says what it opens, until it is open. */
.launcher.labelled { width: auto; height: 52px; padding: 0 22px 0 18px; gap: 9px; display: flex; align-items: center; border-radius: var(--r-pill); }
.launcher.labelled .icon { position: static; }
.launcher.labelled .when-open { display: none; }
.launcher.labelled svg { width: 22px; height: 22px; }
.launcher .label { font-size: 15px; font-weight: 600; white-space: nowrap; }
.badge {
  position: absolute; top: -3px; right: -3px; min-width: 22px; height: 22px; padding: 0 6px;
  border-radius: 999px; background: #e11d48; color: #fff; font-size: 12px; font-weight: 700;
  display: grid; place-items: center; box-shadow: 0 0 0 3px var(--surface);
}

/* A new answer while the panel is closed: its first words, next to the launcher. */
.preview {
  position: fixed; right: var(--x); bottom: calc(var(--y) + 72px); z-index: 2147483000; width: 300px;
  background: var(--surface); color: var(--ink); border: 1px solid var(--line); border-radius: var(--r-bubble);
  box-shadow: var(--shadow);
  animation: rise .28s cubic-bezier(.2,.8,.2,1);
}
.preview-body {
  display: flex; gap: 10px; width: 100%; padding: 12px 36px 12px 12px; text-align: left;
  border: 0; border-radius: inherit; background: transparent;
}
.preview .who { display: block; font-size: 12.5px; color: var(--muted); margin-bottom: 2px; }
.preview .text { font-size: 14px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.preview .dismiss {
  position: absolute; top: 6px; right: 6px; width: 26px; height: 26px; border: 0; border-radius: 50%;
  background: transparent; color: var(--muted); display: grid; place-items: center;
}
.preview .dismiss:hover { background: var(--canvas); color: var(--ink); }
.preview .dismiss svg { width: 14px; height: 14px; }
.root.left .preview { right: auto; left: var(--x); }

/* ── The panel ────────────────────────────────────────────────────────────────── */
.panel {
  position: fixed; inset: auto var(--x) calc(var(--y) + 72px) auto; margin: 0; padding: 0; max-width: none; max-height: none;
  z-index: 2147483000; width: 392px; height: min(680px, calc(100vh - var(--y) - 100px));
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--surface); color: var(--ink);
  border: 0; border-radius: var(--r-panel); box-shadow: var(--shadow);
  transform-origin: bottom right;
  animation: open .32s cubic-bezier(.2,.9,.25,1);
}
@keyframes open { from { opacity: 0; transform: translateY(12px) scale(.96); } }
@keyframes rise { from { opacity: 0; transform: translateY(8px); } }
.root.left .panel { inset: auto auto calc(var(--y) + 72px) var(--x); transform-origin: bottom left; }
@media (max-width: 480px) {
  .root .panel, .root.left .panel { inset: 0; width: 100vw; height: 100dvh; border-radius: 0; }
  .launcher.open { display: none; }
  .root .preview, .root.left .preview { right: 12px; left: 12px; width: auto; }
  .root.hide-mobile { display: none; }
}

/* The header: large while nothing is said — the greeting — then a single line. */
.head {
  position: relative; flex: none; color: var(--accent-ink);
  background: var(--accent);
  padding: 18px 18px 22px;
  transition: padding .3s cubic-bezier(.2,.8,.2,1);
}
.head::after {
  /* A light from above, so the colour has depth rather than flatness. */
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(120% 90% at 0% 0%, rgb(255 255 255 / 0.18), transparent 60%);
}
.head .bar { position: relative; z-index: 1; display: flex; align-items: center; gap: 10px; }
.head .people { display: flex; align-items: center; }
.head .people > * { box-shadow: 0 0 0 2px var(--accent); }
.head .people > * + * { margin-left: -8px; }
.head .logo { width: 32px; height: 32px; border-radius: 9px; object-fit: cover; background: #fff; }
.head .person {
  width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center;
  font-size: 11.5px; font-weight: 650; letter-spacing: .01em;
  background: color-mix(in srgb, var(--accent-ink) 22%, var(--accent)); color: var(--accent-ink);
}
.head .name { font-size: 15px; font-weight: 650; line-height: 1.2; }
.head .status { display: flex; align-items: center; gap: 6px; font-size: 12.5px; opacity: .9; margin-top: 1px; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: #4ade80; flex: none; }
.dot.away { background: #fbbf24; }
.head .close {
  margin-left: auto; width: 34px; height: 34px; border: 0; border-radius: 50%;
  background: transparent; color: inherit; display: grid; place-items: center;
}
.head .close:hover { background: rgb(255 255 255 / 0.16); }
.head .close svg { width: 20px; height: 20px; }
.head .greeting { position: relative; z-index: 1; margin: 18px 2px 0; }
.head .greeting h2 { margin: 0; font-size: 23px; line-height: 1.2; font-weight: 700; letter-spacing: -0.02em; }
.head .greeting p { margin: 6px 0 0; font-size: 14.5px; opacity: .92; max-width: 38ch; }
.head.compact { padding: 12px 14px; }

.notice {
  flex: none; display: flex; gap: 8px; align-items: flex-start;
  padding: 10px 16px; font-size: 13px; line-height: 1.4;
  color: var(--ink-2); background: color-mix(in srgb, #f59e0b 12%, var(--surface));
  border-bottom: 1px solid color-mix(in srgb, #f59e0b 30%, var(--line));
}

/* ── The thread ───────────────────────────────────────────────────────────────── */
.thread {
  flex: 1; overflow-y: auto; padding: 18px 14px 8px; background: var(--canvas);
  display: flex; flex-direction: column; gap: 2px;
  scrollbar-width: thin; scrollbar-color: var(--line) transparent;
}
.group { display: flex; gap: 8px; align-items: flex-end; margin-top: 12px; }
.group:first-child { margin-top: 0; }
.group.mine { flex-direction: row-reverse; }
.group .stack { display: flex; flex-direction: column; gap: 3px; max-width: 82%; min-width: 0; }
.group.mine .stack { align-items: flex-end; }
.avatar-slot { width: 28px; flex: none; }
img.person-avatar { object-fit: cover; background: #fff; }
.person-avatar {
  width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center;
  font-size: 11px; font-weight: 650;
  background: color-mix(in srgb, var(--accent) 14%, var(--surface));
  color: color-mix(in oklab, var(--accent) 75%, var(--ink));
}
.author { font-size: 12px; color: var(--muted); margin: 0 0 2px 12px; display: flex; align-items: center; gap: 6px; }
.ai-tag {
  font-size: 10.5px; font-weight: 650; padding: 1px 6px; border-radius: 999px;
  background: color-mix(in srgb, var(--ai) 14%, transparent);
  color: color-mix(in oklab, var(--ai) 80%, var(--ink));
}
.bubble {
  padding: 9px 14px; border-radius: var(--r-bubble); background: var(--bubble); color: var(--ink);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.06); overflow-wrap: anywhere;
  animation: rise .22s cubic-bezier(.2,.8,.2,1);
}
.group:not(.mine) .bubble.tail { border-bottom-left-radius: var(--r-tail); }
.group.mine .bubble { background: var(--accent); color: var(--accent-ink); box-shadow: none; white-space: pre-wrap; }
.group.mine .bubble.tail { border-bottom-right-radius: var(--r-tail); }
.time { font-size: 11.5px; line-height: 18px; color: var(--muted); margin: 3px 12px 0; }
/* The avatar beside the last bubble, not beside its time. */
.group.timed .avatar-slot { margin-bottom: 21px; }

.md p { margin: 0; }
.md p + p, .md p + ul, .md p + ol, .md ul + p, .md ol + p { margin-top: 8px; }
.md ul, .md ol { margin: 4px 0 0; padding-left: 20px; }
.md li + li { margin-top: 2px; }
.md strong { font-weight: 650; }
.md a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
.md code { font-size: .92em; padding: 1px 5px; border-radius: 6px; background: var(--canvas); }
.bubble.deleted { font-style: italic; color: var(--muted); background: transparent; box-shadow: inset 0 0 0 1px var(--line); }
.md blockquote { margin: 4px 0 0; padding-left: 10px; border-left: 3px solid var(--line); color: var(--ink-2); }
.md p + blockquote, .md blockquote + p { margin-top: 8px; }
.md [data-color="red"] { color: color-mix(in oklab, #dc2626 80%, var(--ink)); }
.md [data-color="orange"] { color: color-mix(in oklab, #ea580c 80%, var(--ink)); }
.md [data-color="green"] { color: color-mix(in oklab, #16a34a 80%, var(--ink)); }
.md [data-color="blue"] { color: color-mix(in oklab, #2563eb 80%, var(--ink)); }
.md [data-color="violet"] { color: color-mix(in oklab, #7c3aed 80%, var(--ink)); }
.md [data-color="grey"] { color: color-mix(in oklab, #71717a 80%, var(--ink)); }

.event {
  align-self: center; display: flex; align-items: center; gap: 10px; width: 100%;
  margin: 14px 0 4px; font-size: 12.5px; color: var(--muted); text-align: center;
}
.event::before, .event::after { content: ""; flex: 1; height: 1px; background: var(--line); }

/* « Laissez-nous votre e-mail »: a card in the thread, the accent on its edge. */
.email-card {
  margin: 10px 0 4px 36px; padding: 12px; border-radius: 14px; background: var(--bubble);
  border: 1px solid var(--line); border-left: 3px solid var(--accent);
  display: flex; flex-direction: column; gap: 10px; font-size: 14px; color: var(--ink);
}
.email-card p { margin: 0; }
.email-why, .email-card.done { display: flex; flex-direction: row; gap: 8px; align-items: flex-start; line-height: 1.45; }
.email-card svg { width: 16px; height: 16px; flex: none; margin-top: 2px; color: var(--accent); }
.email-row { display: flex; gap: 6px; }
.email-row input {
  flex: 1; min-width: 0; height: 36px; padding: 0 10px; border-radius: 10px; font: inherit;
  border: 1px solid var(--line); background: var(--surface); color: var(--ink); outline: none;
}
.email-row input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent); }
.email-row input[aria-invalid="true"] { border-color: #dc2626; }
.email-row button {
  height: 36px; padding: 0 14px; border-radius: 10px; border: 0; font: inherit; font-weight: 600;
  background: var(--accent); color: var(--accent-ink); cursor: pointer;
}
.email-row button:disabled { opacity: .5; cursor: default; }
.email-wrong { font-size: 12.5px; color: #dc2626; }

/* What the visitor might say, where they would say it: one tap sends it. */
.replies { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; margin: 12px 0 4px 36px; }
.reply {
  border: 1.5px solid color-mix(in srgb, var(--accent) 55%, var(--line));
  background: var(--surface); color: color-mix(in oklab, var(--accent) 80%, var(--ink));
  border-radius: var(--r-pill); padding: 7px 14px; font-size: 14px; font-weight: 550; text-align: right;
  transition: background .15s, color .15s, border-color .15s;
  animation: rise .3s cubic-bezier(.2,.8,.2,1) both;
}
.reply:not(:disabled):hover { background: var(--accent); color: var(--accent-ink); border-color: var(--accent); }
.reply:disabled { opacity: .5; cursor: default; }

.typing { display: inline-flex; align-items: center; gap: 4px; height: 38px; padding: 0 16px; }
.typing span { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); animation: blink 1.2s infinite ease-in-out; }
.typing span:nth-child(2) { animation-delay: .15s; }
.typing span:nth-child(3) { animation-delay: .3s; }
@keyframes blink { 0%, 80%, 100% { opacity: .3; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); } }

/* The AI's orb: the site's colour meeting the AI's violet. It turns only while writing. */
.orb {
  position: relative; display: inline-block; flex: none; border-radius: 50%;
  background: conic-gradient(from var(--orb-angle, 0deg), var(--accent), var(--ai), color-mix(in srgb, var(--accent) 60%, #fff), var(--accent));
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.25);
}
.orb-core {
  position: absolute; inset: 22%; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, rgb(255 255 255 / 0.95), rgb(255 255 255 / 0.35) 55%, transparent 72%);
}
@property --orb-angle { syntax: "<angle>"; inherits: false; initial-value: 0deg; }
.orb.busy { animation: orb 2.4s linear infinite; }
@keyframes orb { to { --orb-angle: 360deg; } }

/* ── The composer ─────────────────────────────────────────────────────────────── */
.composer { flex: none; padding: 10px 12px 6px; background: var(--surface); border-top: 1px solid var(--line); }
.field {
  display: flex; align-items: flex-end; gap: 6px; padding: 5px 5px 5px 16px;
  border: 1.5px solid var(--line); border-radius: var(--r-field); background: var(--surface);
  transition: border-color .15s, box-shadow .15s;
}
.field:focus-within {
  border-color: color-mix(in srgb, var(--accent) 70%, var(--line));
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 16%, transparent);
}
.field textarea {
  flex: 1; resize: none; border: 0; outline: none; background: transparent;
  padding: 8px 0; min-height: 38px; max-height: 128px; line-height: 1.45;
}
.field textarea::placeholder { color: var(--muted); }
.send {
  flex: none; width: 38px; height: 38px; border-radius: max(4px, calc(var(--r-field) - 5px)); border: 0;
  background: var(--accent); color: var(--accent-ink); display: grid; place-items: center;
  transition: transform .15s, opacity .15s;
}
.send:not(:disabled):hover { transform: scale(1.05); }
.send:disabled { opacity: .35; cursor: default; }
.send svg { width: 18px; height: 18px; }
.error { margin: 0 4px 6px; font-size: 13px; color: #be123c; }
.composer { position: relative; }
.tool {
  flex: none; width: 32px; height: 38px; border: 0; border-radius: 10px; background: transparent;
  color: var(--muted); display: grid; place-items: center; transition: color .15s, background .15s;
}
.tool:hover, .tool[aria-expanded="true"] { color: var(--ink); background: var(--canvas); }
.tool svg { width: 19px; height: 19px; }

/* The emoji, above the field. */
.emoji {
  min-width: 0; min-inline-size: 0; display: grid; grid-template-columns: repeat(10, minmax(0, 1fr));
  gap: 2px; margin: 0 0 8px; padding: 6px;
  border: 1px solid var(--line); border-radius: 14px; background: var(--surface);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.08); animation: rise .18s cubic-bezier(.2,.8,.2,1);
}
.emoji button {
  aspect-ratio: 1; padding: 0; border: 0; border-radius: 8px; background: transparent; font-size: 18px;
  line-height: 1; transition: transform .1s, background .1s;
}
.emoji button:hover { background: var(--canvas); transform: scale(1.15); }

/* The files about to go. */
.pending { list-style: none; display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 8px; padding: 0; }
.pending li {
  display: flex; align-items: center; gap: 8px; max-width: 100%; padding: 4px 4px 4px 4px;
  border: 1px solid var(--line); border-radius: 12px; background: var(--canvas);
  animation: rise .2s cubic-bezier(.2,.8,.2,1);
}
.pending-thumb {
  width: 34px; height: 34px; flex: none; border-radius: 8px; object-fit: cover;
  display: grid; place-items: center; background: var(--surface); color: var(--muted);
}
.pending-thumb svg { width: 17px; height: 17px; }
.pending-name { font-size: 12.5px; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pending button {
  width: 22px; height: 22px; border: 0; border-radius: 6px; background: transparent; color: var(--muted);
  display: grid; place-items: center;
}
.pending button:hover { color: var(--ink); background: var(--surface); }
.pending button svg { width: 14px; height: 14px; }

/* Dropping files on the composer. */
.drop {
  position: absolute; inset: 6px 10px; z-index: 2; display: grid; place-items: center;
  border: 2px dashed color-mix(in srgb, var(--accent) 70%, var(--line)); border-radius: var(--r-field);
  background: color-mix(in srgb, var(--surface) 92%, transparent); font-size: 14px; font-weight: 600;
  pointer-events: none;
}

/* The files of a message. */
.files { display: flex; flex-direction: column; gap: 4px; max-width: 240px; }
.group.mine .files { align-items: flex-end; }
.shot {
  display: block; overflow: hidden; border-radius: 16px; border: 1px solid var(--line);
  background: var(--canvas); animation: rise .22s cubic-bezier(.2,.8,.2,1);
}
.shot img { display: block; max-width: 240px; max-height: 220px; width: 100%; object-fit: cover; transition: transform .3s; }
.shot:hover img { transform: scale(1.03); }
.file {
  display: flex; align-items: center; gap: 10px; padding: 8px 12px 8px 8px; border-radius: 14px;
  border: 1px solid var(--line); background: var(--surface); color: var(--ink); text-decoration: none;
  transition: border-color .15s; animation: rise .22s cubic-bezier(.2,.8,.2,1);
}
.file:hover { border-color: color-mix(in srgb, var(--accent) 50%, var(--line)); }
.file-icon {
  width: 34px; height: 34px; flex: none; border-radius: 10px; display: grid; place-items: center;
  background: color-mix(in srgb, var(--accent) 12%, var(--surface));
  color: color-mix(in oklab, var(--accent) 75%, var(--ink));
}
.file-icon svg { width: 17px; height: 17px; }
.file-text { display: flex; flex-direction: column; min-width: 0; }
.file-name { font-size: 13px; font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 170px; }
.file-size { font-size: 11.5px; color: var(--muted); }
.foot { padding: 6px 0 2px; text-align: center; font-size: 11.5px; color: var(--muted); }
.disclosure { font-size: 11.5px; color: var(--muted); margin: 4px 12px 0; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
`
