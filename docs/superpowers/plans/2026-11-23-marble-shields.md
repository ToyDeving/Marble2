# Marble Shields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Brave-Shields-like blocker built into Marble: a shield button by the address bar opening a Marble-designed panel, powered by a hidden bundled uBlock Origin.

**Architecture:** uBlock Origin is unpacked into the tree and shipped as a built-in (system, hidden) add-on. We add to that bundled copy (a) a privileged experiment API `browser.marbleShields` for the Firefox-backed switches and (b) our panel page, which talks to uBlock through uBlock's own `vAPI.messaging`. A chrome module adds the toolbar button, a panel hosting that page, the badge, and the global on/off.

**Tech Stack:** Firefox front-end (JS modules, XHTML/CSS, Fluent), WebExtension experiment APIs, uBlock Origin internals.

**Spec:** `docs/superpowers/specs/2026-11-23-marble-shields-design.md`

## Global Constraints
- Engine: uBlock Origin release `.xpi` (id `uBlock0@raymondhill.net`), unpacked unmodified except for the files this plan adds and the manifest keys in Task 2. Ship its `LICENSE.txt`.
- Global switch pref: `marble.shields.enabled` (bool, default `true`).
- Text in pt-BR and en-US. Panel labels (pt-BR): "Proteções ativadas/desativadas para este site", "{n} rastreadores, anúncios e outros conteúdos bloqueados", "Bloquear scripts", "Bloquear pop-ups", "Bloquear impressões digitais", "Esqueça de mim quando fechar este site", "Listas de filtros", "Configurações globais".
- No build or test runs are possible from the agent's environment: every "Run" step is executed by the user in the MozillaBuild shell (`./mach build`, `./mach run`), with the agent checking results through screenshots or files.

## Review Focus
- Panel opened on a page uBlock doesn't filter (about:, moz-extension:, file:) must show "not available here" instead of a broken/empty panel. → Task 3 check.
- Global switch turned off then on must restore blocking without restarting and keep per-site choices. → Task 4 check.
- Private windows: the panel must work and "forget me" must not touch normal-window data. → Task 2 check.
- Many tabs of the same site: "forget me" clears data only after the *last* tab of that site closes. → Task 2 check.
- Existing profiles (the user's) must get the shield on first start after the update, with uBlock's own toolbar button not appearing. → Task 4 check.

---

### Task 1: Bundle uBlock Origin as a built-in add-on

**Files:**
- Create: `browser/extensions/marble-ublock/ublock0/**` (unpacked xpi), `browser/extensions/marble-ublock/jar.mn`
- Modify: `browser/extensions/marble-ublock/moz.build` (replace the distribution approach), `browser/installer/package-manifest.in` (remove the `distribution/extensions/*` line added earlier)

**Interfaces:** Produces add-on id `uBlock0@raymondhill.net` at `resource://builtin-addons/ublock0/`.

- [ ] Unpack the user's xpi into `ublock0/` (drop `META-INF/` signature files; built-ins aren't signature-checked).
- [ ] Package it the way `browser/extensions/webcompat` does (files under `chrome/browser/builtin-addons/ublock0/`), so the build's `built_in_addons.json` lists it. Check how that json is generated (`grep -rn built_in_addons python/ browser/`) and follow it.
- [ ] Run (user): `./mach build` then `./mach run`. Expected: `about:support` → Add-ons lists uBlock Origin as a system add-on; it is absent from about:addons; ads on youtube.com/a news site are blocked.
- [ ] Commit.

### Task 2: `browser.marbleShields` experiment API

**Files:**
- Create: `ublock0/marble/schema.json`, `ublock0/marble/api.js` (parent)
- Modify: `ublock0/manifest.json` (`experiment_apis.marbleShields`)

**Interfaces (all async, `host` is a hostname):**
- `getSiteSettings(host) -> {fingerprinting: bool, forgetMe: bool}`
- `setFingerprinting(host, on: bool)` — on = protection active for host. Backed by Firefox fingerprinting protection; per-site exception through `privacy.fingerprintingProtection.granularOverrides` (verify the exact pref/format in `toolkit/components/resistfingerprinting` first).
- `setForgetMe(host, on: bool)` — stored as permission `marble-forget-me` on `https://host`. A parent-side listener on tab close clears the site's data (`Services.clearData.deleteDataFromSite`, matching the closed tab's originAttributes) when no remaining tab in any window shows that site.
- `closePanel()` — hides the shields panel in the current window.

- [ ] Write the API; in `api.js` start the tab-close listener on API startup (`onStartup` in the manifest's experiment entry).
- [ ] Run (user): open a site, turn on "forget me", log in somewhere, open the site in two tabs, close one (still logged in), close the other (data cleared). Same in a private window leaves normal-window data alone.
- [ ] Commit.

### Task 3: Panel page

**Files:** Create `ublock0/marble/shields.html`, `shields.js`, `shields.css`, `ublock0/_locales/{pt_BR,en}/messages.json` additions (keys prefixed `marbleShields_`).

**Interfaces:** Consumes Task 2 API and uBlock messaging. Read `ublock0/js/popup-fenix.js` and use the exact message names it uses (expected: `getPopupData`, `toggleNetFiltering`, `toggleHostnameSwitch` with `no-scripting` / `no-popups`, `gotoURL` for dashboard pages). Tab id comes from the URL: `shields.html?tabId=N`.

- [ ] Layout per the spec table, dark/light via `prefers-color-scheme`; big switch on top, count box, rows with switches, two buttons at the bottom.
- [ ] Unsupported page (no hostname / `getPopupData` says not filterable): show only "Proteções não disponíveis nesta página".
- [ ] Run (user): every switch changes behaviour on a test site and survives reload; count matches uBlock's.
- [ ] Commit.

### Task 4: Toolbar button, panel, badge, global switch

**Files:**
- Create: `browser/components/marble-shields/MarbleShields.sys.mjs`, `moz.build`, `jar.mn` (button icon + panel CSS); Fluent strings in `browser/locales/en-US/browser/marbleShields.ftl` (+ pt-BR copy)
- Modify: `browser/components/moz.build` (DIRS), `browser/base/content/browser-init.js` or the existing per-window init hook (call `MarbleShields.init(window)`), `browser/app/profile/firefox.js` (`marble.shields.enabled`), `browser/components/preferences/privacy.inc.xhtml` + `privacy.js` (checkbox)

**Interfaces:** `MarbleShields.init(win)`, `MarbleShields.uninit(win)`; panel URL `moz-extension://<uBlock uuid>/marble/shields.html?tabId=<id>` (uuid via `WebExtensionPolicy.getByID`).
- [ ] Button `marble-shields-button` via `CustomizableUI.createWidget`, default placement right after the URL bar; panel = `<panel>` with a remote `<browser>` loading the page in the extension process (copy the setup from `ExtensionPopups.sys.mjs`).
- [ ] Badge = uBlock's per-tab browser action badge text (read from its browserAction context data); updated on tab switch and page load.
- [ ] Remove uBlock's own widget (`ublock0_raymondhill_net-browser-action`) from the toolbar and palette.
- [ ] `marble.shields.enabled` observer: false → disable the add-on (`AddonManager.getAddonByID(...).disable()`), hide button; true → enable, show.
- [ ] Run (user): fresh profile and the existing one both show the shield, not uBlock's button; toggling the Settings checkbox off/on stops/restores blocking without restart.
- [ ] Commit; update `docs/superpowers/specs/...` if anything changed.
