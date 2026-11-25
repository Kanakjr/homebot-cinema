'use strict';
// The download page: one self-contained HTML document (no external requests besides this server's own icon).

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));

function formatSize(bytes) {
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
    if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const date = (ms) => new Date(ms).toISOString().slice(0, 10);

function downloadCard(item) {
    return `<a class="dl" href="file/${encodeURIComponent(item.name)}" download>
        <span class="dl-icon" aria-hidden="true">⬇</span>
        <span class="dl-text"><strong>Download the ${esc(item.label)}</strong>
        <small>${esc(item.name)} · ${formatSize(item.size)} · ${date(item.mtime)}</small></span>
    </a>`;
}

const MAC_STEPS = `
<ol class="steps">
  <li><strong>Download</strong> the file above and open it. A window with the app and your Applications folder appears.</li>
  <li><strong>Drag the app onto Applications</strong>, then close the window and eject the disk in Finder.</li>
  <li><strong>Open it the first time.</strong> It is a home-made app, so macOS asks before it runs it:
    <ul>
      <li>Open the app from Applications. When macOS says it cannot check it, click <em>Done</em>.</li>
      <li>Go to <em>System Settings › Privacy &amp; Security</em>, scroll down and click <em>Open Anyway</em> next to the app, then confirm.</li>
      <li>On older macOS you can instead right-click the app and choose <em>Open</em>.</li>
    </ul>
    You only do this once.</li>
  <li><strong>Sign in</strong> with the same account you used to open this page.</li>
  <li><strong>Pick your profile</strong> under “Who's watching?” and switch on “Remember my choice” so it opens straight away next time.</li>
</ol>
<p class="note">Needs a Mac with Apple Silicon (M1 or newer) and macOS 12 or later. Nothing else to install.</p>
<details><summary>macOS still refuses to open it?</summary>
<p>Open <em>Terminal</em> and run this once, then open the app again:</p>
<pre><code>xattr -dr com.apple.quarantine "/Applications/HomeBot Cinema.app"</code></pre>
</details>`;

const ANDROID_STEPS = `
<ol class="steps">
  <li><strong>Download</strong> the file above on your phone or TV box.</li>
  <li>Open it. If Android asks, allow your browser to <em>install unknown apps</em>, then tap <em>Install</em>.</li>
  <li><strong>Sign in</strong> with the same account you used to open this page, then pick your profile.</li>
</ol>`;

const WEB_STEPS = `
<p>No install needed: <a href="/">open the web app</a> in Safari, Chrome or Edge and sign in with the same account.
On a phone, use <em>Share › Add to Home Screen</em> to get an icon.</p>`;

function section(id, heading, items, steps) {
    const cards = items.map(downloadCard).join('\n');
    return `<section class="card" id="${id}">
      <h2>${heading}</h2>
      ${cards}
      ${steps}
    </section>`;
}

function renderPage({ title = 'Get the app', email = '', installers = [], screenshot = null } = {}) {
    const mac = installers.filter((i) => i.platform === 'mac');
    const android = installers.filter((i) => i.platform === 'android');
    const sections = [
        mac.length ? section('mac', 'Mac', mac.slice(0, 1), MAC_STEPS) : '',
        android.length ? section('android', 'Android', android.slice(0, 1), ANDROID_STEPS) : '',
        section('web', 'Any browser', [], WEB_STEPS),
    ].join('\n');
    const none = installers.length ? '' : '<p class="note center">No apps have been uploaded yet. You can still use the web app below.</p>';

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<link rel="icon" href="/favicons/favicon.svg" type="image/svg+xml">
<style>
  :root { color-scheme: light dark; --bg:#f6f5f2; --fg:#1b1b1f; --muted:#6b6b75; --card:#fff; --line:#e6e4df; --accent:#f08a24; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0d0d10; --fg:#f2f2f4; --muted:#a0a0ab; --card:#17171c; --line:#2a2a31; } }
  * { box-sizing: border-box; }
  body { margin:0; font:16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background:var(--bg); color:var(--fg); }
  main { max-width: 760px; margin: 0 auto; padding: 48px 20px 64px; }
  header { text-align:center; margin-bottom: 28px; }
  header img.logo { width:56px; height:56px; }
  h1 { font-size: 2rem; margin: 12px 0 6px; letter-spacing: -0.02em; }
  .lead { color: var(--muted); margin: 0 auto; max-width: 34em; }
  .who { display:inline-block; margin-top:14px; font-size:.85rem; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:4px 12px; }
  .shot { display:block; width:100%; border-radius:14px; border:1px solid var(--line); margin: 8px 0 28px; box-shadow: 0 10px 40px rgba(0,0,0,.18); }
  .card { background:var(--card); border:1px solid var(--line); border-radius:16px; padding: 22px 24px; margin: 18px 0; }
  .card.recommended { border-color: var(--accent); }
  h2 { margin: 0 0 14px; font-size: 1.25rem; }
  .dl { display:flex; gap:14px; align-items:center; text-decoration:none; color:#fff; background:var(--accent); border-radius:12px; padding:14px 18px; margin-bottom: 18px; }
  .dl:hover { filter: brightness(1.05); }
  .dl-icon { font-size: 1.6rem; line-height: 1; }
  .dl-text { display:flex; flex-direction:column; }
  .dl-text small { opacity:.85; font-size:.8rem; word-break: break-all; }
  .steps { padding-left: 1.3em; margin: 0; }
  .steps > li { margin: 0 0 10px; }
  .steps ul { margin: 6px 0; padding-left: 1.1em; color: var(--muted); }
  .note { color: var(--muted); font-size: .9rem; }
  .center { text-align:center; }
  details { margin-top: 10px; font-size: .92rem; }
  summary { cursor:pointer; color: var(--muted); }
  pre { background: var(--bg); border:1px solid var(--line); border-radius:8px; padding:10px 12px; overflow-x:auto; font-size:.85rem; }
  a { color: var(--accent); }
  footer { text-align:center; margin-top: 36px; }
</style>
</head>
<body>
<main>
  <header>
    <img class="logo" src="/favicons/favicon.svg" alt="">
    <h1>${esc(title)}</h1>
    <p class="lead">Movies and shows from the family server, on your own devices. Download the app for your device, follow the
    few steps below, and you are ready to watch.</p>
    ${email ? `<span class="who">Signed in as ${esc(email)}</span>` : ''}
  </header>
  ${screenshot ? `<img class="shot" src="${esc(screenshot)}" alt="The app's “Who's watching?” screen">` : ''}
  ${none}
  ${sections}
  <section class="card">
    <h2>Good to know</h2>
    <ul class="steps">
      <li>Your profile keeps your own watch history, “Continue watching” and settings. Please stay on your own profile.</li>
      <li>Can't sign in, or see “access denied”? Ask the person who invited you to add your email address.</li>
      <li>Updates to the app's screens arrive by themselves. When a new download appears here, install it the same way over the old one.</li>
    </ul>
  </section>
  <footer><a href="/">Open the web app →</a></footer>
</main>
<script>
  // Put the section for this device first and mark it.
  (function () {
    var ua = navigator.userAgent, id = /Android/i.test(ua) ? 'android' : (/Macintosh/.test(ua) && !('ontouchend' in document) ? 'mac' : 'web');
    var el = document.getElementById(id), first = document.querySelector('section.card');
    if (el && first && el !== first) first.parentNode.insertBefore(el, first);
    if (el) el.classList.add('recommended');
  })();
</script>
</body>
</html>`;
}

module.exports = { renderPage, formatSize, esc };
