# Marble Shields: integrated ad/tracker blocker (design)

## Why
The user wants ad blocking built into Marble, like Brave Shields: a browser
button with a per-site panel, not something that looks like an extension.
People who don't want it must be able to turn it off.

## Approaches considered
- A. Extend Firefox's own tracking-protection shield. Native, but it only
  blocks trackers, not regular ads (YouTube ads would stay). Rejected.
- B. Hidden uBlock Origin + uBlock's own popup in a Marble button. Least work,
  but the panel looks like uBlock's. Not picked.
- C. **Picked.** uBlock Origin as a hidden engine, with a panel designed for
  Marble (Brave-like) that talks to it.

## How C works
- **Engine:** uBlock Origin (GPLv3, gorhill/uBlock) shipped *unpacked* as a
  built-in system add-on in `chrome/browser/builtin-addons/ublock0/`. Built-in
  add-ons are hidden in about:addons, need no signature, and only change when
  Marble is rebuilt with a newer copy, so a uBlock auto-update can never break
  the panel. Filter lists still update themselves daily.
- **Panel page:** one extra page we add inside the bundled uBlock folder
  (`marble-shields.html/js/css`). Being part of the add-on, it can use
  uBlock's own messaging (`vAPI.messaging`, the same calls its popup uses:
  `getPopupData`, `toggleNetFiltering`, `toggleHostnameSwitch`, ...).
- **Button:** a Marble toolbar button (shield + blocked count badge) next to
  the address bar, opening a Marble panel that shows that page. uBlock's own
  toolbar button is hidden.

## Panel contents (v1)
| Brave | Marble | Backed by |
|---|---|---|
| Site name + big on/off | same | uBlock per-site whitelist |
| "N trackers, ads... blocked" | same | uBlock page blocked count |
| Block trackers and ads | count + link to details (uBlock logger) | uBlock |
| Block scripts | toggle | uBlock `no-scripting` per site |
| Block pop-ups | toggle (Marble extra) | uBlock `no-popups` per site |
| Block fingerprinting | toggle | Firefox fingerprinting protection, per-site exception |
| Block third-party cookies | not in v1 (Firefox already isolates them per site) | - |
| Forget me when I close this site | toggle | Firefox per-site "clear cookies on close" permission |
| Filter lists / Global settings buttons | open uBlock's dashboard pages | uBlock |

## Turning it off
- Per site: the big switch.
- Everywhere: Settings > Privacy has "Marble Shields: block ads and trackers"
  (pref `marble.shields.enabled`). Off disables the built-in add-on and
  hides the button. Default on.

## Non-goals
- Our own filtering engine. Mobile. Translating uBlock's dashboard.

## Constraints / notes
- Needs the uBlock Origin release package (the user downloads the .xpi; it
  is unpacked into the tree). Updating uBlock = replacing that folder.
- Ship uBlock's LICENSE.txt with it (GPLv3).
- Text in pt-BR and en-US.
