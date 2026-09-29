#!/usr/bin/env bash
set -euo pipefail

# Run only on a disposable GitHub-hosted Ubuntu runner. This preserves the
# Chromium sandbox and grants user namespaces only to Acadia's test binaries.
if [[ "${CI:-}" != "true" || "${RUNNER_OS:-}" != "Linux" || -z "${GITHUB_WORKSPACE:-}" ]]; then
  echo "This setup script is only for the Linux GitHub Actions runner." >&2
  exit 1
fi
if [[ "$GITHUB_WORKSPACE" == *'"'* || "$GITHUB_WORKSPACE" == *$'\n'* ]]; then
  echo "Unsupported workspace path for an AppArmor profile." >&2
  exit 1
fi

sudo apt-get update
sudo apt-get install --yes --no-install-recommends \
  apparmor dbus-x11 xvfb xauth fakeroot libopenjp2-tools libfuse2t64 libgtk-3-0t64 libnss3 \
  libatk-bridge2.0-0t64 libasound2t64 libgbm1 libdrm2 libxss1 libxtst6 \
  libxkbcommon0 libxshmfence1

if [[ -e /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]]; then
  cat <<EOF | sudo tee /etc/apparmor.d/acadia-ci >/dev/null
abi <abi/4.0>,
include <tunables/global>
profile acadia-ci-development "$GITHUB_WORKSPACE/node_modules/electron/dist/electron" flags=(unconfined) {
  userns,
}
profile acadia-ci-packaged "$GITHUB_WORKSPACE/release/*/linux-unpacked/acadia" flags=(unconfined) {
  userns,
}
EOF
  sudo apparmor_parser --replace /etc/apparmor.d/acadia-ci
fi
