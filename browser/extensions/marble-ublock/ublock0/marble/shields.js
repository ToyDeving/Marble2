/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global browser, vAPI */

"use strict";

// Marble Shields panel. Talks to uBlock Origin through the same messages its
// own popup uses (js/popup-fenix.js, js/messaging.js "popupPanel" channel),
// and to Firefox through the marbleShields experiment API (marble/api.js).

const $ = id => document.getElementById(id);
// Marble's own builds are often en-US while the person reads Portuguese, so
// follow the page language setting (what websites are asked for) for this
// panel's own text.
let ownMessages = null;
async function loadOwnMessages() {
  if (!/^pt/i.test(navigator.language)) {
    return;
  }
  try {
    const response = await fetch("../_locales/pt_BR/messages.json");
    ownMessages = await response.json();
  } catch (ex) {
    ownMessages = null;
  }
}
const t = key =>
  ownMessages?.[key]?.message ?? browser.i18n.getMessage(key);
const send = request => vAPI.messaging.send("popupPanel", request);

let data = null; // uBlock's popup data for the current tab.

function isFilterablePage(popupData) {
  return (
    !!popupData &&
    !!popupData.pageHostname &&
    /^https?:/.test(popupData.rawURL || "")
  );
}

function render(site) {
  const protectedSite = !data.isTrustedSite;
  document.body.classList.toggle("off", !protectedSite);

  $("site-name").textContent = data.pageHostname;
  // Message contains <b>…</b>; built with DOM nodes, not innerHTML.
  const status = $("site-status");
  status.textContent = "";
  const [before, bold, after] = t(
    protectedSite ? "marbleShields_statusOn" : "marbleShields_statusOff"
  ).split("|");
  const b = document.createElement("b");
  b.textContent = bold || "";
  status.append(before || "", b, after || "");
  $("site-switch").checked = protectedSite;

  const count = data.pageCounts?.blocked?.any || 0;
  $("count").textContent = count.toLocaleString();
  $("count-label").textContent = t("marbleShields_blockedCount");

  $("no-scripting").checked = !!data.noScripting;
  $("no-popups").checked = !!data.noPopups;
  $("fingerprinting").checked = !!site.fingerprinting;
  $("forget-me").checked = !!site.forgetMe;
}

async function refresh() {
  data = await send({ what: "getPopupData", tabId: data?.tabId ?? null });
  if (!isFilterablePage(data)) {
    $("panel").hidden = true;
    $("unavailable").hidden = false;
    return;
  }
  const site = await browser.marbleShields.getSiteSettings(data.pageHostname);
  render(site);
  $("unavailable").hidden = true;
  $("panel").hidden = false;
}

function reloadTab() {
  send({ what: "reloadTab", tabId: data.tabId, bypassCache: false });
}

function onSwitch(id, handler) {
  $(id).addEventListener("change", async ev => {
    if (!data) {
      return;
    }
    await handler(ev.target.checked);
    await refresh();
  });
}

function openDashboard(page) {
  send({
    what: "gotoURL",
    details: { url: `dashboard.html#${page}`, select: true, index: -1 },
  });
  browser.marbleShields.closePanel();
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadOwnMessages();
  for (const el of document.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.dataset.i18n);
  }

  onSwitch("site-switch", async on => {
    // uBlock's "trusted site" = protection off for the whole site.
    await send({
      what: "toggleTrustedStatus",
      url: data.pageURL,
      scope: "",
      state: !on,
      tabId: data.tabId,
    });
    reloadTab();
  });

  for (const name of ["no-scripting", "no-popups"]) {
    onSwitch(name, async on => {
      await send({
        what: "toggleHostnameSwitch",
        name,
        hostname: data.pageHostname,
        state: on,
        tabId: data.tabId,
        persist: true,
      });
      if (name == "no-scripting") {
        reloadTab();
      }
    });
  }

  onSwitch("fingerprinting", async on => {
    await browser.marbleShields.setFingerprinting(data.pageHostname, on);
    reloadTab();
  });

  onSwitch("forget-me", on =>
    browser.marbleShields.setForgetMe(data.pageHostname, on)
  );

  $("filter-lists").addEventListener("click", () =>
    openDashboard("3p-filters.html")
  );
  $("global-settings").addEventListener("click", () =>
    openDashboard("settings.html")
  );

  refresh();
});
