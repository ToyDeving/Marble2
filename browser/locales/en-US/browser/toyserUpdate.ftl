# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

## Toyser "new version available" bar.

# Variables:
#   $version (String) - The new version, e.g. "1.2.0".
toyser-update-available = { -brand-short-name } { $version } is available.
toyser-update-button = Update now
toyser-update-later = Later
toyser-update-skip = Skip this version

## Toyser "Check for updates" item in the app menu.

toyser-update-check-menu =
    .label = Check for updates…
# Variables:
#   $version (String) - The installed version, e.g. "1.3.0".
toyser-update-up-to-date = { -brand-short-name } { $version } is up to date.
toyser-update-check-failed = Couldn’t check for updates. Check your connection and try again.
