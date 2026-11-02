#!/usr/bin/env bash
# Offline checks of the automation (no cluster): the namespace guard sees every namespace the charts
# create, and each cluster profile renders the platform chart it promises.
set -euo pipefail
cd "$(dirname "$0")/../.."
fail() { echo "selftest FAIL: $*" >&2; exit 1; }

for profile in "" sandbox-ocp5; do
  args=(); [[ -n $profile ]] && args=(-f automation/argocd/values-$profile.yaml)
  ns=$(LIST_ONLY=1 bash automation/guard-namespaces.sh rhoai-3day-field-workshop apps.example.com ${args[@]+"${args[@]}"})
  for want in openshift-nfd nvidia-gpu-operator workshop-showroom ws-platform; do
    grep -qx "$want" <<<"$ns" || fail "guard (profile '${profile:-default}') does not list namespace $want"
  done
done

# The guard's decisions, with oc stubbed: absent or ours passes; foreign or an API error refuses.
guard() { bash automation/guard-namespaces.sh rhoai-3day-field-workshop apps.example.com >/dev/null 2>&1; }
oc() { :; }; export -f oc
guard || fail "guard refused when no namespace exists"
oc() { case "$*" in "get namespace "*) a="$*"; n=${a#get namespace }; printf '%s/rhoai-3day-field-workshop' "${n%% *}";; esac; }; export -f oc
[ "$(oc get namespace openshift-nfd --ignore-not-found -o x)" = openshift-nfd/rhoai-3day-field-workshop ] || fail "ownership stub is not answering"
guard || fail "guard refused namespaces this lab owns"
oc() { case "$*" in "get subscriptions"*) printf 'web-terminal openshift-operators/web-terminal rhoai-3day-field-workshop\n';; esac; }; export -f oc
guard || fail "guard refused a Subscription this lab owns"
oc() { case "$*" in "get subscriptions"*) printf 'web-terminal openshift-operators/web-terminal \n';; esac; }; export -f oc
guard && fail "guard accepted an existing Web Terminal Subscription it does not own"
oc() { case "$*" in "get catalogsource certified-operators-v420 "*) printf 'certified-operators-v420/';; esac; }; export -f oc
bash automation/guard-namespaces.sh rhoai-3day-field-workshop apps.example.com -f automation/argocd/values-sandbox-ocp5.yaml >/dev/null 2>&1 &&
  fail "guard accepted a CatalogSource it does not own"
oc() { case "$*" in *"get namespace nvidia-gpu-operator "*) printf 'nvidia-gpu-operator/another-lab';; esac; }; export -f oc
guard && fail "guard accepted a namespace owned by another lab"
oc() { case "$*" in *"get namespace openshift-nfd "*) printf 'openshift-nfd/';; esac; }; export -f oc
guard && fail "guard accepted an unlabelled existing namespace (openshift-nfd)"
oc() { return 1; }; export -f oc
guard && fail "guard accepted when oc failed"
unset -f oc

# Render the platform child exactly as the parent passes it, per profile.
platform() {
  local tmp; tmp=$(mktemp)
  helm template lab automation/argocd -f automation/argocd/values.yaml "$@" --set deployer.domain=apps.example.com |
    awk '/^---/ {p = 0} $1 == "path:" && $2 ~ /components\/platform$/ {p = 1}
         p && $1 == "valuesObject:" {vo = 1; ind = match($0, /[^ ]/); next}
         vo { if (match($0, /[^ ]/) <= ind) vo = 0; else print substr($0, ind + 2) }' >"$tmp"
  helm template lab automation/argocd/components/platform -f "$tmp"; rm -f "$tmp"
}
default=$(platform)
grep -q 'kind: CatalogSource' <<<"$default" && fail "default profile must not add a CatalogSource"
grep -A3 'name: rhcl-operator$' <<<"$default" | grep -q 'namespace: openshift-operators' || fail "default RHCL namespace is not openshift-operators"

sandbox=$(platform -f automation/argocd/values-sandbox-ocp5.yaml)
grep -q 'image: registry.redhat.io/redhat/certified-operator-index:v4.20' <<<"$sandbox" || fail "sandbox profile lacks the v4.20 certified catalog"
grep -A3 'name: rhcl-operator$' <<<"$sandbox" | grep -q 'namespace: openshift-auth-operator' || fail "sandbox RHCL namespace is not openshift-auth-operator"
grep -A12 'name: gpu-operator-certified$' <<<"$sandbox" | grep -q 'source: certified-operators-v420' || fail "sandbox GPU operator source is not certified-operators-v420"
echo "selftest: PASS"
