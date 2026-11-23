/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Marble web panels: "MarbleWebPanelUnread" window actor, registered by
 * web-panel.js for the WhatsApp Web panel only.
 *
 * The child counts the chats in WhatsApp Web's chat list that have unread
 * messages, leaving out groups and communities. The parent turns that into
 * the dot on the WhatsApp icon in the sidebar launcher
 * (sidebar.notification.badge.whatsapp, read by
 * SidebarController.handleToolBadges), which stays until the chats are read.
 *
 * WhatsApp Web has no public API for this, so the child reads the page: a
 * row is "unread" if it has an unread-count badge, and a "group" if it shows
 * the group/community default picture or its last message starts with the
 * sender's name ("Name: message"), which only group chats do. Best effort:
 * if WhatsApp changes its page this may need adjusting. What the child saw
 * is kept in marble.webpanels.whatsapp.unreadDebug to help with that.
 */

const BADGE_PREF = "sidebar.notification.badge.whatsapp";
const DEBUG_PREF = "marble.webpanels.whatsapp.unreadDebug";
const INTERVAL_MS = 2000;
const UNREAD_LABEL = /n[ãa]o lida|unread|no le[ií]da/i;
const GROUP_ICONS =
  '[data-icon="default-group"], [data-icon="default-community"], [data-icon="community"]';
const SENDER_PREFIX = /^~?\s?[^:\n]{1,40}:\s/;

function isGroupRow(row) {
  if (row.querySelector(GROUP_ICONS)) {
    return true;
  }
  const lines = (row.innerText || "")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);
  return lines.some(
    (line, i) => i > 0 && SENDER_PREFIX.test(line) && !/^https?:/.test(line)
  );
}

/** @returns {{count: number|null, debug: string}} */
function countUnreadChats(doc) {
  const list = doc.getElementById("pane-side");
  if (!list) {
    return { count: null, debug: `no #pane-side; title=${doc.title}` };
  }
  const rows = list.querySelectorAll('[role="listitem"], [role="row"]');
  let count = 0;
  let unreadRows = 0;
  const samples = [];
  for (const row of rows) {
    const badge = [...row.querySelectorAll("[aria-label]")].find(el =>
      UNREAD_LABEL.test(el.getAttribute("aria-label"))
    );
    if (!badge) {
      continue;
    }
    unreadRows++;
    const group = isGroupRow(row);
    if (!group) {
      count++;
    }
    if (samples.length < 5) {
      samples.push(`${group ? "G" : "P"}:${badge.getAttribute("aria-label")}`);
    }
  }
  const labels = new Set(
    [...list.querySelectorAll("[aria-label]")]
      .slice(0, 40)
      .map(el => el.getAttribute("aria-label").slice(0, 30))
  );
  return {
    count,
    debug: `rows=${rows.length} unreadRows=${unreadRows} counted=${count} title=${doc.title} samples=${samples.join(",")} labels=${[...labels].join("|")}`,
  };
}

export class MarbleWebPanelUnreadChild extends JSWindowActorChild {
  #timer = null;
  #last = null;

  handleEvent(event) {
    if (event.type == "DOMContentLoaded" && !this.#timer) {
      this.#timer = this.contentWindow.setInterval(
        () => this.#check(),
        INTERVAL_MS
      );
    }
  }

  #check() {
    let result;
    try {
      result = countUnreadChats(this.document);
    } catch (ex) {
      result = { count: null, debug: `error: ${ex}` };
    }
    const key = `${result.count}|${result.debug}`;
    if (key != this.#last) {
      this.#last = key;
      this.sendAsyncMessage("Unread", result);
    }
  }

  didDestroy() {
    if (this.#timer) {
      try {
        this.contentWindow?.clearInterval(this.#timer);
      } catch (ex) {}
    }
  }
}

export class MarbleWebPanelUnreadParent extends JSWindowActorParent {
  receiveMessage({ name, data }) {
    if (name != "Unread") {
      return;
    }
    Services.prefs.setStringPref(
      DEBUG_PREF,
      String(data?.debug ?? "").slice(0, 2000)
    );
    let unread;
    if (data?.count == null) {
      // No chat list found (loading, logged out, page changed): fall back to
      // the unread count in the title, e.g. "(3) WhatsApp".
      const title =
        this.browsingContext.top.embedderElement?.contentTitle || "";
      unread = /^\((\d+)\)/.test(title);
    } else {
      unread = data.count > 0;
    }
    if (Services.prefs.getBoolPref(BADGE_PREF, false) != unread) {
      Services.prefs.setBoolPref(BADGE_PREF, unread);
    }
  }
}
