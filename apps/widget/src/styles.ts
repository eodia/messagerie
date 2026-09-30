/**
 * The widget's styles, inside its shadow root: the page's CSS cannot reach them, and they
 * reach nothing of the page. basedb's neutrals, the SITE's colour as the accent.
 */
export const STYLES = `
:host { all: initial; }
* { box-sizing: border-box; }
.root {
  --accent: #2563eb;
  --accent-text: #fff;
  --ink: #18181b;
  --muted: #71717a;
  --line: #e4e4e7;
  --surface: #fafafa;
  --card: #fff;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 14px;
  line-height: 1.45;
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
}
button, textarea { font: inherit; color: inherit; }
button { cursor: pointer; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.launcher {
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
  width: 56px; height: 56px; border-radius: 999px; border: 0;
  background: var(--accent); color: var(--accent-text);
  display: grid; place-items: center;
  box-shadow: 0 10px 25px -5px rgb(0 0 0 / 0.25), 0 4px 10px -6px rgb(0 0 0 / 0.2);
  transition: transform .15s ease;
}
.launcher:hover { transform: scale(1.05); }
.launcher svg { width: 26px; height: 26px; }
.badge {
  position: absolute; top: -2px; right: -2px; min-width: 20px; height: 20px; padding: 0 6px;
  border-radius: 999px; background: #ef4444; color: #fff; font-size: 11px; font-weight: 700;
  display: grid; place-items: center; box-shadow: 0 0 0 2px #fff;
}

.panel {
  position: fixed; inset: auto 20px 88px auto; margin: 0; padding: 0; max-width: none; max-height: none; z-index: 2147483000;
  width: 376px; height: min(640px, calc(100vh - 112px));
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--card); border: 1px solid var(--line); border-radius: 16px;
  box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.25);
  animation: rise .18s ease-out;
}
@keyframes rise { from { opacity: 0; transform: translateY(8px) scale(.98); } }
@media (max-width: 480px) {
  .panel { inset: 0; width: 100vw; height: 100dvh; border-radius: 0; border: 0; }
  .panel + .launcher, .launcher.open { display: none; }
}
@media (prefers-reduced-motion: reduce) { .panel { animation: none; } .launcher { transition: none; } }

.head {
  display: flex; align-items: center; gap: 12px; padding: 14px 16px;
  background: var(--accent); color: var(--accent-text);
}
.head .mark {
  width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center;
  background: rgb(255 255 255 / 0.18); font-weight: 700;
}
.head .title { font-size: 15px; font-weight: 600; line-height: 1.2; }
.head .status { font-size: 12px; opacity: .88; display: flex; align-items: center; gap: 6px; margin-top: 2px; }
.dot { width: 7px; height: 7px; border-radius: 999px; background: #4ade80; box-shadow: 0 0 0 2px rgb(255 255 255 / 0.3); }
.dot.away { background: #fbbf24; }
.head .close {
  margin-left: auto; width: 32px; height: 32px; border: 0; border-radius: 8px;
  background: transparent; color: inherit; display: grid; place-items: center;
}
.head .close:hover { background: rgb(255 255 255 / 0.15); }
.head .close svg { width: 18px; height: 18px; }

.notice {
  padding: 8px 16px; font-size: 12px; color: #92400e; background: #fffbeb;
  border-bottom: 1px solid #fde68a;
}

.thread { flex: 1; overflow-y: auto; padding: 16px; background: var(--surface); display: flex; flex-direction: column; gap: 12px; scrollbar-width: thin; scrollbar-color: var(--line) transparent; }

.row { display: flex; gap: 8px; align-items: flex-end; max-width: 88%; }
.row.mine { align-self: flex-end; flex-direction: row-reverse; }
.avatar {
  flex: none; width: 28px; height: 28px; border-radius: 999px; display: grid; place-items: center;
  font-size: 11px; font-weight: 700; margin-bottom: 18px;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: color-mix(in oklab, var(--accent) 75%, var(--ink));
}
.avatar svg { width: 16px; height: 16px; }
.who { font-size: 11px; color: var(--muted); margin: 0 0 3px 4px; display: flex; align-items: center; gap: 6px; }
.ai-tag {
  font-size: 10px; font-weight: 600; padding: 0 5px; border-radius: 999px; line-height: 16px;
  background: color-mix(in srgb, #8b5cf6 15%, transparent); color: #6d28d9;
}
.bubble {
  padding: 9px 13px; border-radius: 16px 16px 16px 4px; background: var(--card);
  border: 1px solid var(--line); white-space: pre-wrap; overflow-wrap: anywhere;
}
.mine .bubble { border-radius: 16px 16px 4px 16px; background: var(--accent); color: var(--accent-text); border-color: transparent; }
.time { font-size: 11px; color: var(--muted); margin: 3px 4px 0; }
.mine .time { text-align: right; }

.event {
  align-self: center; font-size: 12px; color: var(--muted); background: var(--card);
  border: 1px solid var(--line); border-radius: 999px; padding: 3px 10px;
}

.typing { display: inline-flex; gap: 4px; padding: 12px 14px; }
.typing span { width: 6px; height: 6px; border-radius: 999px; background: var(--muted); animation: blink 1.2s infinite ease-in-out; }
.typing span:nth-child(2) { animation-delay: .15s; }
.typing span:nth-child(3) { animation-delay: .3s; }
@keyframes blink { 0%, 80%, 100% { opacity: .25; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-2px); } }

.composer { border-top: 1px solid var(--line); padding: 10px 12px; display: flex; gap: 8px; align-items: flex-end; background: var(--card); }
.composer textarea {
  flex: 1; resize: none; border: 1px solid var(--line); border-radius: 12px; padding: 9px 12px;
  max-height: 120px; min-height: 40px; outline: none; background: var(--card);
}
.composer textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent); }
.send {
  flex: none; width: 40px; height: 40px; border-radius: 12px; border: 0;
  background: var(--accent); color: var(--accent-text); display: grid; place-items: center;
}
.send:disabled { opacity: .45; cursor: default; }
.send svg { width: 18px; height: 18px; }
.error { padding: 6px 16px; font-size: 12px; color: #b91c1c; background: #fef2f2; border-top: 1px solid #fecaca; }
.foot { padding: 6px; text-align: center; font-size: 11px; color: var(--muted); background: var(--card); }
`
