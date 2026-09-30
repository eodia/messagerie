/**
 * The page the widget editor frames: a site sketched in grey — a header, a title, a few
 * blocks — so that the widget is seen where it will live, over a page, at its corner. The
 * widget on it is in preview mode: it waits for the editor's settings (`data-preview`,
 * the inbox's origin) and never calls the chat server.
 */

const htmlEscape = (value: string) => value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)

export function previewPage(editorOrigin: string): string {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Aperçu du widget</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; background: #f4f4f5; color: #18181b;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .bar { display: flex; align-items: center; gap: 18px; height: 56px; padding: 0 28px; background: #fff; border-bottom: 1px solid #e4e4e7; }
  .mark { width: 26px; height: 26px; border-radius: 7px; background: #d4d4d8; }
  .line { height: 10px; border-radius: 5px; background: #e4e4e7; }
  .nav { display: flex; gap: 14px; margin-left: auto; }
  .nav .line { width: 54px; }
  main { max-width: 760px; padding: 56px 28px; }
  .title { height: 26px; border-radius: 8px; background: #d4d4d8; width: 72%; margin-bottom: 14px; }
  .title.short { width: 46%; margin-bottom: 26px; }
  .text { display: grid; gap: 10px; max-width: 520px; }
  .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: 40px; }
  .card { height: 96px; border-radius: 12px; background: #fff; border: 1px solid #e4e4e7; }
  @media (max-width: 560px) { .cards { grid-template-columns: 1fr; } .nav { display: none; } }
</style>
</head>
<body>
<div class="bar" aria-hidden="true"><span class="mark"></span><span class="line" style="width:110px"></span><span class="nav"><span class="line"></span><span class="line"></span><span class="line"></span></span></div>
<main aria-hidden="true">
  <div class="title"></div>
  <div class="title short"></div>
  <div class="text"><span class="line"></span><span class="line" style="width:92%"></span><span class="line" style="width:64%"></span></div>
  <div class="cards"><span class="card"></span><span class="card"></span><span class="card"></span></div>
</main>
<script src="/widget.js" data-site="preview" data-preview="${htmlEscape(editorOrigin)}" async></script>
</body>
</html>`
}
