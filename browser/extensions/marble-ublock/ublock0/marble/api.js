/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global ExtensionAPI, Services */

"use strict";

// Marble Shields: the switches of the shields panel that are backed by
// Firefox itself rather than by uBlock Origin.

const FPP_PREF = "privacy.fingerprintingProtection";
const FPP_OVERRIDES_PREF = "privacy.fingerprintingProtection.granularOverrides";
// Also read by browser/components/marble-shields/MarbleShields.sys.mjs.
const FORGET_ME_PERMISSION = "marble-forget-me";

function siteOf(host) {
  try {
    return Services.eTLD.getBaseDomainFromHost(host);
  } catch (ex) {
    // IP addresses, localhost, ...
    return host;
  }
}

function principalOf(host) {
  return Services.scriptSecurityManager.createContentPrincipalFromOrigin(
    `https://${host}`
  );
}

function readOverrides() {
  try {
    const list = JSON.parse(Services.prefs.getStringPref(FPP_OVERRIDES_PREF, "[]"));
    return Array.isArray(list) ? list : [];
  } catch (ex) {
    return [];
  }
}

function isExempt(site, overrides = readOverrides()) {
  return overrides.some(
    o => o.firstPartyDomain == site && !o.thirdPartyDomain && o.overrides == "-AllTargets"
  );
}

this.marbleShields = class extends ExtensionAPI {
  getAPI() {
    return {
      marbleShields: {
        async getSiteSettings(host) {
          const site = siteOf(host);
          return {
            fingerprinting:
              Services.prefs.getBoolPref(FPP_PREF, false) && !isExempt(site),
            forgetMe:
              Services.perms.testPermissionFromPrincipal(
                principalOf(site),
                FORGET_ME_PERMISSION
              ) == Services.perms.ALLOW_ACTION,
          };
        },

        async setFingerprinting(host, on) {
          const site = siteOf(host);
          let overrides = readOverrides().filter(
            o => !(o.firstPartyDomain == site && !o.thirdPartyDomain && o.overrides == "-AllTargets")
          );
          if (!on) {
            overrides.push({ firstPartyDomain: site, overrides: "-AllTargets" });
          }
          Services.prefs.setStringPref(FPP_OVERRIDES_PREF, JSON.stringify(overrides));
        },

        async setForgetMe(host, on) {
          const principal = principalOf(siteOf(host));
          if (on) {
            Services.perms.addFromPrincipal(
              principal,
              FORGET_ME_PERMISSION,
              Services.perms.ALLOW_ACTION
            );
          } else {
            Services.perms.removeFromPrincipal(principal, FORGET_ME_PERMISSION);
          }
        },

        async closePanel() {
          const win = Services.wm.getMostRecentWindow("navigator:browser");
          win?.document.getElementById("marble-shields-panel")?.hidePopup();
        },
      },
    };
  }
};
