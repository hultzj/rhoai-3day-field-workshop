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

# teardown-csvs.sh, with oc stubbed (cluster state in files): record keeps only CSVs installed by this
# lab's Subscriptions; delete removes exactly those; a failed delete keeps the record so a rerun finishes.
st=$(mktemp -d); export ST=$st
oc() {
  local a="$*"
  case "$a" in
    "get subscriptions.operators.coreos.com -A -l app.kubernetes.io/part-of=lab "*) cat "$ST/subs" ;;
    "get configmap lab-installed-csvs "*) [[ -e $ST/cm ]] && cat "$ST/cm"; return 0 ;;
    "create configmap lab-installed-csvs "*) a=${a#*--from-literal=csvs=}; printf '%s' "${a% --dry-run*}" >"$ST/cm.new" ;;
    "apply -f -") cat >/dev/null; mv "$ST/cm.new" "$ST/cm" ;;
    "delete csv "*) echo "$3/$5" >>"$ST/attempts"; [[ -e $ST/fail-once ]] && { rm "$ST/fail-once"; return 1; }
                    echo "$3/$5" >>"$ST/deleted" ;;
    "delete configmap lab-installed-csvs "*) rm -f "$ST/cm" ;;
  esac
}; export -f oc
# The label selector returns only this lab's Subscriptions; a foreign web-terminal Subscription elsewhere
# is never listed, so its CSV can never be recorded.
printf 'openshift-operators web-terminal.v1\nopenshift-nfd nfd.v1\nopenshift-auth-operator \n' >"$st/subs"
bash automation/teardown-csvs.sh record lab || fail "record failed"
[ "$(cat "$st/cm")" = "$(printf 'openshift-nfd nfd.v1\nopenshift-operators web-terminal.v1')" ] ||
  fail "record saved '$(cat "$st/cm")'"
: >"$st/subs"   # the Applications are gone: no Subscriptions left
touch "$st/fail-once"
bash automation/teardown-csvs.sh record lab || fail "second record failed"
bash automation/teardown-csvs.sh delete lab >/dev/null 2>&1 && fail "delete reported success although a delete failed"
[ -e "$st/cm" ] || fail "the record was dropped although a delete failed"
bash automation/teardown-csvs.sh delete lab >/dev/null 2>&1 || fail "rerun of delete failed"
[ -e "$st/cm" ] && fail "the record survived a fully successful delete"
[ "$(sort -u "$st/deleted" | tr '\n' ' ')" = "nfd.v1/openshift-nfd web-terminal.v1/openshift-operators " ] ||
  fail "deleted '$(sort -u "$st/deleted" | tr '\n' ' ')'"
unset -f oc; rm -rf "$st"

# If recording ownership fails, make teardown must stop before deleting anything.
oc() { case "$1" in get) return 1 ;; delete) echo UNEXPECTED_DELETE ;; esac; return 0; }; export -f oc
out=$(make --no-print-directory -C automation teardown 2>&1) && fail "teardown succeeded although recording CSV ownership failed"
grep -q UNEXPECTED_DELETE <<<"$out" && fail "teardown deleted something after recording failed"
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
