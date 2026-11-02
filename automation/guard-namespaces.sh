#!/usr/bin/env bash
# Refuse to deploy if anything this lab would adopt already exists without this lab's ownership label
# (app.kubernetes.io/part-of=<app>): Argo CD would adopt it, and teardown would delete it. Checked:
# every namespace a child deploys into or creates, every operator package the platform subscribes to
# (an existing Subscription for it anywhere), and every CatalogSource it creates.
# Usage: guard-namespaces.sh <lab app name> <ingress domain> [helm args, e.g. -f values-<profile>.yaml]
# LIST_ONLY=1 prints the namespaces instead of checking them (automation/tests/selftest.sh).
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
app=$1 domain=$2
shift 2
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

parent=$(helm template "$app" "$HERE/argocd" -f "$HERE/argocd/values.yaml" "$@" --set deployer.domain="$domain")
# Each child Application from this repo: its path and the valuesObject the parent passes (as in check-lab.sh).
awk -v dir="$tmp" '
  function flush() {
    if (path != "") { n++; printf "%s", vals > (dir "/" n ".values"); print path > (dir "/" n ".path"); close(dir "/" n ".values"); close(dir "/" n ".path") }
    path = ""; vals = ""; vo = 0
  }
  /^---/ { flush(); next }
  vo { if ($0 ~ /^[[:space:]]*$/) next
       if (match($0, /[^ ]/) <= ind) vo = 0; else { vals = vals substr($0, ind + 2) "\n"; next } }
  $1 == "path:" && $2 ~ /^automation\// { path = $2 }
  $1 == "valuesObject:" { vo = 1; ind = match($0, /[^ ]/) }
  END { flush() }
' <<<"$parent"

children=$(
  for pf in "$tmp"/*.path; do
    [[ -e $pf ]] || break
    printf -- '---\n'; helm template "$app" "$HERE/../$(<"$pf")" -f "${pf%.path}.values"
  done
)
namespaces=$(
  {
    awk '$1 == "destination:" {d = 1} d && $1 == "namespace:" {print $2; d = 0}' <<<"$parent"
    awk '/^kind: Namespace$/ {n = 1} n && /^  name: / {print $2; n = 0}' <<<"$children"
  } | sort -u
)
# "<kind> <name> <package>" for each Subscription (package = spec.name) and CatalogSource.
olm=$(awk '
  /^---/ { if (k) print k, n, p; k = n = p = ""; sec = "" }
  /^kind: (Subscription|CatalogSource)$/ { k = $2 }
  /^[a-z]+:/ { sec = $1 }
  sec == "metadata:" && /^  name: / { n = $2 }
  sec == "spec:" && /^  name: / { p = $2 }
  END { if (k) print k, n, p }' <<<"$children")
[[ -n $namespaces ]] || { echo "guard-namespaces: rendered no namespaces" >&2; exit 1; }
if [[ -n ${LIST_ONLY:-} ]]; then echo "$namespaces"; [[ $LIST_ONLY == all ]] && echo "$olm"; exit 0; fi

bad=0
for ns in $namespaces; do
  state=$(oc get namespace "$ns" --ignore-not-found -o jsonpath='{.metadata.name}/{.metadata.labels.app\.kubernetes\.io/part-of}')
  case "$state" in
    "" | "$ns/$app") ;;
    *) echo "namespace $ns exists and is not this lab's ($app): its operator is probably installed already; disable that operator in a profile (platform.values.<operator>.enabled: false) or rename the namespace" >&2; bad=1 ;;
  esac
done
subs=$(oc get subscriptions.operators.coreos.com -A -o jsonpath='{range .items[*]}{.spec.name} {.metadata.namespace}/{.metadata.name} {.metadata.labels.app\.kubernetes\.io/part-of}{"\n"}{end}')
while read -r kind name pkg; do
  [[ -n $kind ]] || continue
  if [[ $kind == Subscription ]]; then
    while read -r spkg where owner; do
      [[ $spkg == "$pkg" && $owner != "$app" ]] || continue
      echo "operator $pkg is already subscribed ($where) and not by this lab: set platform.values.<operator>.enabled: false in a profile" >&2; bad=1
    done <<<"$subs"
  else
    owner=$(oc get catalogsource "$name" -n openshift-marketplace --ignore-not-found -o jsonpath='{.metadata.name}/{.metadata.labels.app\.kubernetes\.io/part-of}')
    case "$owner" in "" | "$name/$app") ;; *) echo "CatalogSource $name exists and is not this lab's: give the extra catalog its own name (gpuOperator.source)" >&2; bad=1 ;; esac
  fi
done <<<"$olm"
exit "$bad"
