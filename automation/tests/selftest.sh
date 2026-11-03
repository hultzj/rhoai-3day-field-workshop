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

# teardown-csvs.sh, with oc stubbed (cluster state in files): record keeps the CSVs of this lab's
# Subscriptions and of the dependency Subscriptions OLM generated for them (and those Subscriptions),
# never a pre-existing or unrelated one; delete removes exactly those; a failed delete keeps the record.
st=$(mktemp -d); export ST=$st
oc() {
  local a="$*"
  case "$a" in
    "get subscriptions.operators.coreos.com -A -o json") cat "$ST/subs.json" ;;
    "get configmap lab-installed-csvs "*) [[ -e $ST/cm ]] && cat "$ST/cm"; return 0 ;;
    "create configmap lab-installed-csvs "*) a=${a#*--from-literal=csvs=}; printf '%s' "${a% --dry-run*}" >"$ST/cm.new" ;;
    "apply -f -") cat >/dev/null; mv "$ST/cm.new" "$ST/cm" ;;
    "delete subscriptions.operators.coreos.com "*) echo "sub:$5/$3" >>"$ST/deleted" ;;
    "delete csv "*) echo "$3/$5" >>"$ST/attempts"; [[ -e $ST/fail-once ]] && { rm "$ST/fail-once"; return 1; }
                    echo "$3/$5" >>"$ST/deleted" ;;
    "delete configmap lab-installed-csvs "*) rm -f "$ST/cm" ;;
  esac
}; export -f oc
cat >"$st/subs.json" <<'JSON'
{"items":[
 {"metadata":{"namespace":"openshift-operators","name":"web-terminal","creationTimestamp":"2026-11-02T11:00:19Z","labels":{"app.kubernetes.io/part-of":"lab"}},
  "spec":{"name":"web-terminal","channel":"fast","source":"redhat-operators","sourceNamespace":"openshift-marketplace"},"status":{"installedCSV":"web-terminal.v1"}},
 {"metadata":{"namespace":"openshift-auth-operator","name":"rhcl-operator","creationTimestamp":"2026-11-02T11:00:18Z","labels":{"app.kubernetes.io/part-of":"lab"}},
  "spec":{"name":"rhcl-operator","channel":"stable-1.4","source":"rh","sourceNamespace":"openshift-marketplace"},"status":{"installedCSV":"rhcl-operator.v1"}},
 {"metadata":{"namespace":"openshift-auth-operator","name":"dns-operator-stable-rh-openshift-marketplace","creationTimestamp":"2026-11-02T11:00:33Z"},
  "spec":{"name":"dns-operator","channel":"stable","source":"rh","sourceNamespace":"openshift-marketplace"},"status":{"installedCSV":"dns-operator.v1"}},
 {"metadata":{"namespace":"openshift-auth-operator","name":"authorino-operator","creationTimestamp":"2026-09-18T03:35:23Z"},
  "spec":{"name":"authorino-operator","channel":"stable","source":"redhat-operators","sourceNamespace":"openshift-marketplace"},"status":{"installedCSV":"authorino-operator.v1"}},
 {"metadata":{"namespace":"openshift-auth-operator","name":"other-stable-rh-openshift-marketplace","creationTimestamp":"2026-11-02T11:00:34Z"},
  "spec":{"name":"other","channel":"stable","source":"rh","sourceNamespace":"openshift-marketplace"},"status":{"installedCSV":"other.v1"}},
 {"metadata":{"namespace":"openshift-operators","name":"dns-operator-stable-rh-openshift-marketplace","creationTimestamp":"2026-11-02T11:00:33Z"},
  "spec":{"name":"dns-operator","channel":"stable","source":"rh","sourceNamespace":"openshift-marketplace"},"status":{"installedCSV":"unrelated-dns.v1"}},
 {"metadata":{"namespace":"openshift-operators","name":"devworkspace-operator-fast-redhat-operators-openshift-marketplace","creationTimestamp":"2026-11-02T11:00:19Z"},
  "spec":{"name":"devworkspace-operator","channel":"fast","source":"redhat-operators","sourceNamespace":"openshift-marketplace"},"status":{"installedCSV":"devworkspace-operator.v0"}},
 {"metadata":{"namespace":"openshift-auth-operator","name":"limitador-operator-stable-rh-openshift-marketplace","creationTimestamp":"2026-11-02T11:00:17Z"},
  "spec":{"name":"limitador-operator","channel":"stable","source":"rh","sourceNamespace":"openshift-marketplace"},"status":{"installedCSV":"limitador-operator.v0"}}
]}
JSON
bash automation/teardown-csvs.sh record lab || fail "record failed"
want=$(printf '%s\n' "openshift-auth-operator dns-operator.v1" "openshift-auth-operator rhcl-operator.v1" "openshift-operators web-terminal.v1" "sub openshift-auth-operator dns-operator-stable-rh-openshift-marketplace" | sort)
[ "$(cat "$st/cm")" = "$want" ] || fail "record saved '$(tr '\n' ';' <"$st/cm")'"
echo '{"items":[]}' >"$st/subs.json"   # the Applications are gone: no lab Subscriptions left
touch "$st/fail-once"
bash automation/teardown-csvs.sh record lab || fail "second record failed"
bash automation/teardown-csvs.sh delete lab >/dev/null 2>&1 && fail "delete reported success although a delete failed"
[ -e "$st/cm" ] || fail "the record was dropped although a delete failed"
bash automation/teardown-csvs.sh delete lab >/dev/null 2>&1 || fail "rerun of delete failed"
[ -e "$st/cm" ] && fail "the record survived a fully successful delete"
got=$(sort -u "$st/deleted" | tr '\n' ' ')
[ "$got" = "dns-operator.v1/openshift-auth-operator rhcl-operator.v1/openshift-auth-operator sub:openshift-auth-operator/dns-operator-stable-rh-openshift-marketplace web-terminal.v1/openshift-operators " ] ||
  fail "deleted '$got'"
# authorino: pre-existing; other: unrelated package installed in the same window; limitador: generated
# name and a dependency package, but created before the lab's Subscription, so not caused by it;
# devworkspace: the same, created in the same second as the lab's Subscription; unrelated-dns: a
# dependency package, but not one of web-terminal's (the lab Subscription in its namespace)
grep -q -E 'authorino|other|limitador|devworkspace|unrelated-dns|openshift-operators/dns' "$st/deleted" && fail "deleted a pre-existing or unrelated operator"
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
