/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Marble Shields: toolbar button + panel for the built-in blocker.
 *
 * The blocking engine is uBlock Origin, shipped as a hidden built-in add-on
 * (browser/extensions/marble-ublock). The panel is the add-on's own page
 * marble/shields.html, shown here inside a Marble panel instead of an
 * extension popup. See docs/superpowers/specs/2026-11-23-marble-shields-design.md
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AddonManager: "resource://gre/modules/AddonManager.sys.mjs",
  CustomizableUI:
    "moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs",
  ExtensionParent: "resource://gre/modules/ExtensionParent.sys.mjs",
});

const ADDON_ID = "uBlock0@raymondhill.net";
const UBLOCK_WIDGET_ID = "ublock0_raymondhill_net-browser-action";
const BUTTON_ID = "marble-shields-button";
const PANEL_ID = "marble-shields-panel";
const BROWSER_ID = "marble-shields-browser";
const ENABLED_PREF = "marble.shields.enabled";
const BUTTON_PLACED_PREF = "marble.shields.buttonPlaced";
const FPP_PREF = "privacy.fingerprintingProtection";
// Also written by the add-on's marble/api.js.
const FORGET_ME_PERMISSION = "marble-forget-me";
const BADGE_INTERVAL_MS = 1000;

function enabled() {
  return Services.prefs.getBoolPref(ENABLED_PREF, true);
}

function siteOf(uri) {
  try {
    if (!uri?.schemeIs("http") && !uri?.schemeIs("https")) {
      return null;
    }
    return Services.eTLD.getBaseDomain(uri);
  } catch (ex) {
    return uri?.host || null;
  }
}

function promiseEvent(target, type) {
  return new Promise(resolve =>
    target.addEventListener(type, resolve, { once: true })
  );
}

export const MarbleShields = {
  _initialized: false,
  _windows: new Map(), // window -> badge timer id

  init(win) {
    win.MozXULElement.insertFTLIfNeeded("browser/marbleShields.ftl");
    win.windowUtils.loadSheetUsingURIString(
      "chrome://browser/content/marble-shields/marble-shields.css",
      win.windowUtils.AUTHOR_SHEET
    );

    if (!this._initialized) {
      this._initialized = true;
      this._createWidget();
      Services.prefs.addObserver(ENABLED_PREF, this);
      this._applyEnabled();
    }

    win.gBrowser.tabContainer.addEventListener("TabClose", this);
    this._windows.set(
      win,
      win.setInterval(() => this._updateButton(win), BADGE_INTERVAL_MS)
    );
    this._updateButton(win);
    win.addEventListener("unload", () => this.uninit(win), { once: true });
  },

  uninit(win) {
    win.clearInterval(this._windows.get(win));
    this._windows.delete(win);
    win.gBrowser?.tabContainer.removeEventListener("TabClose", this);
  },

  _createWidget() {
    const { CustomizableUI } = lazy;
    CustomizableUI.createWidget({
      id: BUTTON_ID,
      type: "custom",
      onBuild: doc => {
        const node = doc.createXULElement("toolbarbutton");
        node.id = BUTTON_ID;
        node.className = "toolbarbutton-1 chromeclass-toolbar-additional";
        node.setAttribute("badged", "true");
        node.setAttribute("removable", "true");
        node.setAttribute("data-l10n-id", "marble-shields-button");
        // Use the document we were built for: the event target can be in
        // another scope (e.g. when the button sits in the overflow panel).
        node.addEventListener("command", () =>
          this.openPanel(doc.defaultView, node)
        );
        return node;
      },
    });

    // First run: put the button right after the address bar.
    if (!Services.prefs.getBoolPref(BUTTON_PLACED_PREF, false)) {
      Services.prefs.setBoolPref(BUTTON_PLACED_PREF, true);
      if (!CustomizableUI.getPlacementOfWidget(BUTTON_ID)) {
        const urlbar = CustomizableUI.getPlacementOfWidget("urlbar-container");
        CustomizableUI.addWidgetToArea(
          BUTTON_ID,
          CustomizableUI.AREA_NAVBAR,
          urlbar?.area == CustomizableUI.AREA_NAVBAR
            ? urlbar.position + 1
            : undefined
        );
      }
    }

    // uBlock's own button is replaced by the shields button.
    if (CustomizableUI.getPlacementOfWidget(UBLOCK_WIDGET_ID)) {
      CustomizableUI.removeWidgetFromArea(UBLOCK_WIDGET_ID);
    }
    CustomizableUI.addListener({
      onWidgetAdded(widgetId) {
        if (widgetId == UBLOCK_WIDGET_ID) {
          CustomizableUI.removeWidgetFromArea(UBLOCK_WIDGET_ID);
        }
      },
    });
  },

  /** uBlock's per-tab browser action state, or null if it isn't running. */
  _ublockAction() {
    const extension = WebExtensionPolicy.getByID(ADDON_ID)?.extension;
    if (!extension) {
      return null;
    }
    return lazy.ExtensionParent.apiManager.global.browserActionFor?.(extension)
      ?.action;
  },

  _updateButton(win) {
    const node = win.document.getElementById(BUTTON_ID);
    if (!node) {
      return;
    }
    node.hidden = !enabled();
    const action = this._ublockAction();
    const tab = win.gBrowser.selectedTab;
    let badge = "";
    let off = false;
    if (action && tab) {
      badge = action.getProperty(tab, "badgeText") || "";
      // uBlock shows its "-off" icon on sites where protection is off.
      const icon = action.getProperty(tab, "icon");
      off = JSON.stringify(icon || "").includes("-off");
    }
    if (badge) {
      node.setAttribute("badge", badge);
    } else {
      node.removeAttribute("badge");
    }
    node.toggleAttribute("shields-off", off);
  },

  async openPanel(win, anchor) {
    const doc = win.document;
    let panel = doc.getElementById(PANEL_ID);
    if (!panel) {
      panel = doc.createXULElement("panel");
      panel.id = PANEL_ID;
      panel.setAttribute("type", "arrow");
      panel.setAttribute("role", "dialog");
      panel.addEventListener("popuphidden", () =>
        doc.getElementById(BROWSER_ID)?.remove()
      );
      doc.getElementById("mainPopupSet").appendChild(panel);
    }
    panel.openPopup(anchor, "bottomright topright");
    await this._loadPage(panel);
  },

  async _loadPage(panel) {
    const doc = panel.ownerDocument;
    doc.getElementById(BROWSER_ID)?.remove();

    const policy = WebExtensionPolicy.getByID(ADDON_ID);
    const extension = policy?.extension;
    if (!extension) {
      return;
    }

    const browser = doc.createXULElement("browser");
    browser.id = BROWSER_ID;
    browser.setAttribute("type", "content");
    browser.setAttribute("disableglobalhistory", "true");
    browser.setAttribute("messagemanagergroup", "webext-browsers");
    browser.setAttribute("webextension-view-type", "popup");
    browser.setAttribute("tooltip", "aHTMLTooltip");
    browser.setAttribute(
      "initialBrowsingContextGroupId",
      policy.browsingContextGroupId
    );
    if (extension.remote) {
      browser.setAttribute("remote", "true");
      browser.setAttribute("remoteType", extension.remoteType);
      browser.setAttribute("maychangeremoteness", "true");
    }

    const ready = promiseEvent(
      browser,
      extension.remote ? "XULFrameLoaderCreated" : "load"
    );
    panel.appendChild(browser);
    await ready;

    lazy.ExtensionParent.apiManager.emit("extension-browser-inserted", browser);
    const mm = browser.messageManager;
    mm.loadFrameScript(
      "chrome://extensions/content/ext-browser-content.js",
      false,
      true
    );
    mm.sendAsyncMessage("Extension:InitBrowser", {
      allowScriptsToClose: true,
      fixedWidth: true,
      maxWidth: 800,
      maxHeight: 600,
      stylesheets: [],
    });
    mm.addMessageListener("Extension:BrowserResized", ({ data }) => {
      if (data?.height) {
        browser.style.height = `${data.height}px`;
      }
    });
    browser.fixupAndLoadURIString(policy.getURL("marble/shields.html"), {
      triggeringPrincipal: extension.principal,
    });
  },

  async _applyEnabled() {
    const on = enabled();
    if (on) {
      Services.prefs.clearUserPref(FPP_PREF);
    } else {
      Services.prefs.setBoolPref(FPP_PREF, false);
    }
    try {
      const addon = await lazy.AddonManager.getAddonByID(ADDON_ID);
      if (addon && addon.userDisabled == on) {
        await (on
          ? addon.enable({ allowSystemAddons: true })
          : addon.disable({ allowSystemAddons: true }));
      }
    } catch (ex) {
      console.error("Marble Shields: could not switch the blocker", ex);
    }
    for (const win of this._windows.keys()) {
      this._updateButton(win);
    }
  },

  // nsIObserver (marble.shields.enabled)
  observe(_subject, topic) {
    if (topic == "nsPref:changed") {
      this._applyEnabled();
    }
  },

  // "Forget me when I close this site": clear the site's data once its last
  // tab (in windows of the same kind, normal or private) is closed.
  handleEvent(event) {
    if (event.type != "TabClose") {
      return;
    }
    const browser = event.target.linkedBrowser;
    const site = siteOf(browser?.currentURI);
    if (!site) {
      return;
    }
    const principal =
      Services.scriptSecurityManager.createContentPrincipalFromOrigin(
        `https://${site}`
      );
    if (
      Services.perms.testPermissionFromPrincipal(
        principal,
        FORGET_ME_PERMISSION
      ) != Services.perms.ALLOW_ACTION
    ) {
      return;
    }
    const privateBrowsingId =
      browser.contentPrincipal?.originAttributes.privateBrowsingId ?? 0;
    const closingTab = event.target;

    // Let the tab finish closing before looking at what's left.
    Services.tm.dispatchToMainThread(() => {
      for (const win of this._windows.keys()) {
        for (const tab of win.gBrowser.tabs) {
          if (
            tab != closingTab &&
            !tab.closing &&
            siteOf(tab.linkedBrowser.currentURI) == site &&
            (tab.linkedBrowser.contentPrincipal?.originAttributes
              .privateBrowsingId ?? 0) == privateBrowsingId
          ) {
            return;
          }
        }
      }
      Services.clearData.deleteDataFromSite(
        site,
        { privateBrowsingId },
        true,
        Ci.nsIClearDataService.CLEAR_COOKIES_AND_SITE_DATA,
        () => {}
      );
    });
  },

  QueryInterface: ChromeUtils.generateQI(["nsIObserver"]),
};
