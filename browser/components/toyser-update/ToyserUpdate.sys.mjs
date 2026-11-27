/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Toyser updates: once a day, look at the latest GitHub Release of the
 * Toyser repository. If its tag (e.g. "v1.2.0") is newer than
 * toyser.version, show a bar in the browser window offering to download and
 * run the installer attached to that release. See docs/toyser-releases.md.
 */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  Downloads: "resource://gre/modules/Downloads.sys.mjs",
  PlacesUtils: "resource://gre/modules/PlacesUtils.sys.mjs",
});

const VERSION_PREF = "toyser.version";
const REPO_PREF = "toyser.update.repository";
const ENABLED_PREF = "toyser.update.enabled";
const LAST_CHECK_PREF = "toyser.update.lastCheck";
const SKIP_PREF = "toyser.update.skipVersion";
const CHECK_EVERY_SECONDS = 24 * 60 * 60;
const FIRST_CHECK_DELAY_MS = 30 * 1000;
const CLEANUP_DELAY_MS = 10 * 1000;
const INSTALLER_NAME = /^Toyser-.+-Instalador\.exe$/i;
const NOTIFICATION_VALUE = "toyser-update-available";
const RESULT_NOTIFICATION_VALUE = "toyser-update-check-result";

function versionOf(tag) {
  return String(tag || "").replace(/^v/i, "").trim();
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

export const ToyserUpdate = {
  _started: false,
  _latest: null, // { version, url, page }

  /** Called for every new browser window. */
  init(win) {
    win.MozXULElement.insertFTLIfNeeded("browser/toyserUpdate.ftl");
    if (this._latest) {
      this._notify(win);
    }
    if (this._started) {
      return;
    }
    this._started = true;
    win.setTimeout(() => this._removeOldInstallers(), CLEANUP_DELAY_MS);
    win.setTimeout(() => this._checkIfDue(), FIRST_CHECK_DELAY_MS);
    // Keep checking once a day for people who never close the browser.
    Services.tm.dispatchToMainThread(() => {
      const timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
      timer.initWithCallback(
        () => this._checkIfDue(),
        60 * 60 * 1000,
        Ci.nsITimer.TYPE_REPEATING_SLACK
      );
      this._timer = timer;
    });
  },

  async _checkIfDue() {
    if (!Services.prefs.getBoolPref(ENABLED_PREF, true)) {
      return;
    }
    const last = Services.prefs.getIntPref(LAST_CHECK_PREF, 0);
    if (nowSeconds() - last < CHECK_EVERY_SECONDS && !this._latest) {
      return;
    }
    Services.prefs.setIntPref(LAST_CHECK_PREF, nowSeconds());
    await this.check();
  },

  /**
   * "Check for updates" in the app menu: checks right away, even for a
   * skipped version. A newer version shows the update bar in every window;
   * otherwise this window gets a short "up to date" or "failed" bar.
   */
  async checkNow(win) {
    const box = win.gNotificationBox;
    box?.getNotificationWithValue(RESULT_NOTIFICATION_VALUE)?.close();
    Services.prefs.setIntPref(LAST_CHECK_PREF, nowSeconds());
    Services.prefs.clearUserPref(SKIP_PREF);
    const result = await this.check();
    if (result && result !== "error") {
      return;
    }
    if (!box) {
      return;
    }
    const label =
      result === "error"
        ? await win.document.l10n.formatValue("toyser-update-check-failed")
        : await win.document.l10n.formatValue("toyser-update-up-to-date", {
            version: Services.prefs.getStringPref(VERSION_PREF, ""),
          });
    await box.appendNotification(RESULT_NOTIFICATION_VALUE, {
      label,
      priority:
        result === "error" ? box.PRIORITY_WARNING_LOW : box.PRIORITY_INFO_LOW,
    });
  },

  /**
   * Looks up the latest release. Returns it if it is newer than this
   * version, null if there is nothing newer, or "error" if the lookup failed.
   */
  async check() {
    const repo = Services.prefs.getStringPref(REPO_PREF, "");
    const current = Services.prefs.getStringPref(VERSION_PREF, "0");
    if (!repo) {
      return "error";
    }
    let release;
    try {
      const response = await fetch(
        `https://api.github.com/repos/${repo}/releases/latest`,
        { headers: { Accept: "application/vnd.github+json" } }
      );
      if (!response.ok) {
        return "error";
      }
      release = await response.json();
    } catch (ex) {
      console.warn("Toyser update check failed", ex);
      return "error";
    }

    const version = versionOf(release.tag_name);
    if (!version || Services.vc.compare(version, current) <= 0) {
      return null;
    }
    if (Services.prefs.getStringPref(SKIP_PREF, "") == version) {
      return null;
    }
    const assets = (release.assets || []).filter(a => /\.exe$/i.test(a.name));
    const installer =
      assets.find(a => /instalador|installer|setup/i.test(a.name)) ||
      assets[0];
    this._latest = {
      version,
      url: installer?.browser_download_url || null,
      page: release.html_url,
    };
    for (const win of Services.wm.getEnumerator("navigator:browser")) {
      this._notify(win);
    }
    return this._latest;
  },

  async _notify(win) {
    const box = win.gNotificationBox;
    if (!box || box.getNotificationWithValue(NOTIFICATION_VALUE)) {
      return;
    }
    const { version } = this._latest;
    const [label, updateLabel, laterLabel, skipLabel] =
      await win.document.l10n.formatValues([
        { id: "toyser-update-available", args: { version } },
        { id: "toyser-update-button" },
        { id: "toyser-update-later" },
        { id: "toyser-update-skip" },
      ]);
    await box.appendNotification(
      NOTIFICATION_VALUE,
      { label, priority: box.PRIORITY_INFO_HIGH },
      [
        {
          label: updateLabel,
          callback: () => {
            this._update(win);
            return false;
          },
        },
        { label: laterLabel, callback: () => false },
        {
          label: skipLabel,
          callback: () => {
            Services.prefs.setStringPref(SKIP_PREF, version);
            this._latest = null;
            return false;
          },
        },
      ]
    );
  },

  /**
   * Deletes installers that "Update now" downloaded earlier, and removes
   * them from the downloads list. An installer that is still running is
   * locked, so it is left for the next startup.
   */
  async _removeOldInstallers() {
    let removed = [];
    try {
      for (const path of await IOUtils.getChildren(PathUtils.tempDir)) {
        if (!INSTALLER_NAME.test(PathUtils.filename(path))) {
          continue;
        }
        try {
          await IOUtils.remove(path);
          removed.push(path);
        } catch (ex) {}
      }
      if (!removed.length) {
        return;
      }
      const list = await lazy.Downloads.getList(lazy.Downloads.ALL);
      for (const download of await list.getAll()) {
        if (removed.includes(download.target.path)) {
          await list.remove(download);
          await download.finalize(true).catch(() => {});
          await lazy.PlacesUtils.history
            .remove(download.source.url)
            .catch(() => {});
        }
      }
    } catch (ex) {
      console.warn("Toyser installer cleanup failed", ex);
    }
  },

  /** Downloads the installer and runs it; falls back to the release page. */
  async _update(win) {
    const { url, page, version } = this._latest;
    if (!url) {
      win.openTrustedLinkIn(page, "tab");
      return;
    }
    try {
      const dir = Services.dirsvc.get("TmpD", Ci.nsIFile);
      dir.append(`Toyser-${version}-Instalador.exe`);
      const download = await lazy.Downloads.createDownload({
        source: url,
        target: dir.path,
      });
      const list = await lazy.Downloads.getList(lazy.Downloads.ALL);
      await list.add(download); // Shows up in the downloads panel.
      await download.start();
      dir.launch();
    } catch (ex) {
      console.error("Toyser update download failed", ex);
      win.openTrustedLinkIn(page, "tab");
    }
  },
};
