/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/**
 * Marble web panels: shows websites (WhatsApp, Instagram, TikTok...) inside
 * the sidebar. This page is loaded once per window in #sidebar-webpanels and
 * is never unloaded: each site gets its own browser, created the first time
 * it is opened, and closing the sidebar only hides it.
 */

const { topChromeWindow } = window.browsingContext;

const WEB_PANEL_SITES = {
  whatsapp: {
    url: "https://web.whatsapp.com/",
    mobile: false,
    // Loaded in the background at startup so new messages show up as a dot
    // on its sidebar icon (see watchUnread).
    preload: true,
    // Count unread chats from the page itself so groups can be left out
    // (MarbleWebPanelUnread actor, WebPanelUnread.sys.mjs).
    unreadActor: true,
    // "Enable notifications" and "Enable background sync" ask for these.
    permissions: ["desktop-notification", "persistent-storage"],
  },
  // No mobile user agent: Instagram's login rejects a phone user agent coming
  // from a desktop browser. Its desktop site still adapts to narrow widths.
  instagram: {
    url: "https://www.instagram.com/",
    // No mobile user agent: Instagram's login rejects a phone user agent
    // coming from a desktop browser.
    mobile: false,
    // Loaded in the background at startup so new messages show up as a dot
    // on its sidebar icon. Instagram puts the unread count in its title,
    // e.g. "(2) Instagram" (see watchUnread).
    preload: true,
  },
  tiktok: {
    url: "https://www.tiktok.com/",
    // No mobile user agent: with it TikTok expects touch input, so mouse
    // drags (e.g. its "drag the slider" check) don't work.
    mobile: false,
  },
};

const browsers = new Map();
let currentSite = null;

function mobileUserAgent() {
  const version = parseInt(Services.appinfo.version, 10) + ".0";
  return `Mozilla/5.0 (Android 14; Mobile; rv:${version}) Gecko/${version} Firefox/${version}`;
}

/**
 * Pages in a web panel have no notification bar or permission prompts, so a
 * blocked popup (such as "Log in with Facebook") or a permission request
 * (such as WhatsApp's notifications) would fail silently. Allow popups, plus
 * the site's own extra permissions, for the panel's own site. Choices the
 * user already made for the site are kept.
 */
function allowPermissions(site) {
  let principal;
  try {
    principal = Services.scriptSecurityManager.createContentPrincipalFromOrigin(
      new URL(site.url).origin
    );
  } catch (ex) {
    console.error("Bad web panel URL", ex);
    return;
  }
  for (const type of ["popup", ...(site.permissions || [])]) {
    try {
      if (
        Services.perms.testPermissionFromPrincipal(principal, type) ==
        Services.perms.UNKNOWN_ACTION
      ) {
        Services.perms.addFromPrincipal(
          principal,
          type,
          Services.perms.ALLOW_ACTION
        );
      }
    } catch (ex) {
      console.error(`Could not allow ${type} for web panel`, ex);
    }
  }
}

/**
 * Show a dot on the site's icon in the sidebar launcher while it has unread
 * messages (sidebar.notification.badge.<key>, read by
 * SidebarController.handleToolBadges). The dot stays until the messages are
 * read.
 *
 * With site.unreadActor (WhatsApp), the MarbleWebPanelUnread window actor
 * counts unread chats in the page itself, leaving groups out. Otherwise the
 * unread count in the title, e.g. "(3) Site", is used.
 */
function watchUnread(key, browser) {
  if (WEB_PANEL_SITES[key].unreadActor) {
    registerUnreadActor();
    return;
  }
  const pref = `sidebar.notification.badge.${key}`;
  browser.addEventListener("pagetitlechanged", () => {
    const unread = /^\((\d+)\)/.test(browser.contentTitle || "");
    if (Services.prefs.getBoolPref(pref, false) != unread) {
      Services.prefs.setBoolPref(pref, unread);
    }
  });
}

function registerUnreadActor() {
  try {
    ChromeUtils.registerWindowActor("MarbleWebPanelUnread", {
      parent: {
        esModuleURI:
          "moz-src:///browser/components/sidebar/WebPanelUnread.sys.mjs",
      },
      child: {
        esModuleURI:
          "moz-src:///browser/components/sidebar/WebPanelUnread.sys.mjs",
        events: { DOMContentLoaded: {} },
      },
      matches: ["https://web.whatsapp.com/*"],
      // Only in the web panels, not in normal tabs.
      messageManagerGroups: ["web-panel-browser"],
    });
  } catch (ex) {
    // Already registered by another window.
  }
}

function createBrowser(site) {
  allowPermissions(site);
  const browser = document.createXULElement("browser");
  browser.setAttribute("disableglobalhistory", "true");
  browser.setAttribute("maychangeremoteness", "true");
  browser.setAttribute("messagemanagergroup", "web-panel-browser");
  browser.setAttribute("nodefaultsrc", "true");
  browser.setAttribute("remote", "true");
  browser.setAttribute("type", "content");
  document.getElementById("browser-container").appendChild(browser);

  if (site.mobile) {
    // Copied over to new browsing contexts when the process changes.
    browser.browsingContext.customUserAgent = mobileUserAgent();
  }
  browser.fixupAndLoadURIString(site.url, {
    triggeringPrincipal: Services.scriptSecurityManager.createNullPrincipal(
      {}
    ),
  });
  return browser;
}

function currentBrowser() {
  return browsers.get(currentSite);
}

/**
 * Web panel pages aren't tabs, so nothing else tells Firefox when they are on
 * screen. An inactive page is barely drawn (like a background tab), which
 * makes a panel look frozen after it was hidden and shown again.
 */
function setActive(browser) {
  try {
    browser.docShellIsActive = !browser.hidden;
  } catch (ex) {
    // Not ready yet; DidChangeBrowserRemoteness below catches up.
  }
}

function ensureBrowser(key) {
  if (!browsers.has(key)) {
    const browser = createBrowser(WEB_PANEL_SITES[key]);
    // Not shown until showWebPanel() picks it.
    browser.hidden = key != currentSite;
    setActive(browser);
    // A new process for the page starts out inactive again.
    browser.addEventListener("DidChangeBrowserRemoteness", () =>
      setActive(browser)
    );
    watchUnread(key, browser);
    browsers.set(key, browser);
  }
  return browsers.get(key);
}

/**
 * Load the sites marked "preload" in the background (without showing them).
 * Called by SidebarController in browser-sidebar.js shortly after startup.
 *
 * @param {string[]} keys The sites whose sidebar panels are enabled.
 */
function preloadWebPanels(keys) {
  for (const key of keys) {
    if (WEB_PANEL_SITES[key]?.preload) {
      ensureBrowser(key);
    }
  }
}
window.preloadWebPanels = preloadWebPanels;

/**
 * Show the given site, creating its browser the first time.
 * Called by SidebarController in browser-sidebar.js.
 *
 * @param {string} key One of the WEB_PANEL_SITES keys.
 */
function showWebPanel(key) {
  const site = WEB_PANEL_SITES[key];
  if (!site) {
    console.error(`Unknown web panel site: ${key}`);
    return;
  }
  ensureBrowser(key);
  currentSite = key;
  for (const [otherKey, browser] of browsers) {
    browser.hidden = otherKey != key;
    setActive(browser);
  }
  currentBrowser().focus();
}
window.showWebPanel = showWebPanel;

addEventListener("DOMContentLoaded", () => {
  document.getElementById("web-panel-back").addEventListener("click", () => {
    const browser = currentBrowser();
    if (browser?.canGoBack) {
      browser.goBack();
    }
  });
  document
    .getElementById("web-panel-reload")
    .addEventListener("click", () => currentBrowser()?.reload());
  document
    .getElementById("web-panel-open-tab")
    .addEventListener("click", () => {
      const browser = currentBrowser();
      if (!browser) {
        return;
      }
      const url =
        browser.currentURI?.spec || WEB_PANEL_SITES[currentSite].url;
      topChromeWindow.openLinkIn(url, "tab", {
        triggeringPrincipal:
          Services.scriptSecurityManager.createNullPrincipal({}),
      });
    });
  // "Minimize": only hides the sidebar, the site keeps running.
  document
    .getElementById("web-panel-close")
    .addEventListener("click", () => topChromeWindow.SidebarController.hide());

  // Old-style URLs (web-panel.html?site=whatsapp) still work.
  const key = new URLSearchParams(location.search).get("site");
  if (key) {
    showWebPanel(key);
  }
});
