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

# An RHDP order injects gitops.repoURL; it must win over gitops.repoUrl for the platform source and
# the Showroom content, and gitops.repoUrl must still serve make bootstrap.
repos() { helm template lab automation/argocd -f automation/argocd/values.yaml --set deployer.domain=apps.example.com "$@" |
  awk '$1 == "repoURL:" && $2 ~ /\/components\/platform$|\.git$/ && $2 !~ /field-sourced-content-template/ {print "platform " $2}
       $1 == "repoUrl:" {gsub(/"/, "", $2); print "showroom " $2}' | sort; }
[ "$(repos --set gitops.repoURL=https://example.com/order.git --set gitops.repoUrl=https://example.com/boot.git)" = $'platform https://example.com/order.git\nshowroom https://example.com/order.git' ] ||
  fail "the order's gitops.repoURL does not reach the platform source and the Showroom content"
[ "$(repos --set gitops.repoUrl=https://example.com/boot.git)" = $'platform https://example.com/boot.git\nshowroom https://example.com/boot.git' ] ||
  fail "without an order, gitops.repoUrl does not reach the platform source and the Showroom content"

# verify.sh picks the parent: the bootstrap name when it exists, else an RHDP order's field-content,
# and an explicit LAB_APP always wins. Only the Applications line is judged; oc is stubbed.
oc() { case "$*" in
  *"applications.argoproj.io rhoai-3day-field-workshop "*) [ -n "${BOOT:-}" ] && echo application/rhoai-3day-field-workshop ;;
  *"applications.argoproj.io field-content "*) [ -n "${RHDP:-}" ] && echo application/field-content ;;
  *"applications.argoproj.io -l"*) printf '%b' "$APPS" ;;
  *) return 1 ;; esac; return 0; }
export -f oc
# verify exits non-zero here (the other checks fail against the stub), so only its output is judged.
apps_line() { local out; out=$(env "$@" bash automation/verify.sh 2>/dev/null) || true; grep 'lab Applications are Synced/Healthy' <<<"$out" || true; }
rhdp_apps='field-content Synced/Healthy\nfield-content-platform Synced/Healthy field-content\nfield-content-showroom Synced/Healthy field-content\n'
boot_apps='rhoai-3day-field-workshop Synced/Healthy rhoai-3day-field-workshop\nrhoai-3day-field-workshop-platform Synced/Healthy rhoai-3day-field-workshop\nrhoai-3day-field-workshop-showroom Synced/Healthy rhoai-3day-field-workshop\n'
apps_line -u LAB_APP RHDP=1 APPS="$rhdp_apps" | grep -q '^PASS' || fail "verify does not find an RHDP order's field-content parent"
apps_line -u LAB_APP BOOT=1 APPS="$boot_apps" | grep -q '^PASS' || fail "verify does not fall back to the bootstrap parent"
apps_line -u LAB_APP BOOT=1 RHDP=1 APPS="${boot_apps}field-content OutOfSync/Degraded\n" | grep -q '^PASS' || fail "an unrelated field-content hides a healthy bootstrap deployment"
apps_line LAB_APP=field-content BOOT=1 RHDP=1 APPS="$rhdp_apps" | grep -q '^PASS' || fail "an explicit LAB_APP is not honoured"
apps_line -u LAB_APP RHDP=1 APPS="$boot_apps" | grep -q '^FAIL' || fail "verify passes an RHDP order whose field-content children are missing"
unset -f oc

# order-prep runs on an RHDP order (guid injected) and never on make bootstrap unless forced.
apps() { helm template field-content automation/argocd -f automation/argocd/values.yaml --set deployer.domain=apps.example.com "$@"; }
grep -q 'name: field-content-order-prep' <<<"$(apps)" && fail "order-prep rendered without an RHDP order"
grep -q 'name: field-content-order-prep' <<<"$(apps --set guid=abc12-1)" || fail "order-prep missing on an RHDP order"
grep -q 'name: field-content-order-prep' <<<"$(apps --set guid=abc12-1 --set orderPrep.enabled=false)" && fail "orderPrep.enabled=false ignored"
grep -q 'name: field-content-order-prep' <<<"$(apps --set orderPrep.enabled=true)" || fail "orderPrep.enabled=true ignored"
prep=$(helm template field-content automation/argocd/components/order-prep --set partOf=field-content)
grep -A6 'kind: Namespace' <<<"$prep" | grep -q 'app.kubernetes.io/part-of: field-content' || fail "order-prep namespace lacks the lab's part-of label"
for c in kserve modelregistry trustyai; do grep -q "\\\\\"$c\\\\\":{\\\\\"managementState\\\\\":\\\\\"Managed\\\\\"}" <<<"$prep" || fail "order-prep does not enable $c"; done
grep -q 'INSTANCE=g6.2xlarge' <<<"$prep" || fail "order-prep GPU instance type is not g6.2xlarge"
grep -q 'name: add-gpu-node' <<<"$(helm template t automation/argocd/components/order-prep --set partOf=x --set gpu.enabled=false)" && fail "gpu.enabled=false still adds the GPU node"

# The GPU Job's script, run with oc stubbed: it skips when a -gpu-l4 MachineSet exists, and otherwise
# creates one tainted g6.2xlarge copied from the first worker MachineSet.
gpujob=$(helm template t automation/argocd/components/order-prep --set partOf=field-content |
  python3 -c 'import json,sys
for l in sys.stdin:
    l = l.strip()
    if l.startswith("command:") and "add-gpu" not in l and "-gpu-l4" in l: print(json.loads(l[len("command:"):])[2])')
[ -n "$gpujob" ] || fail "could not extract the GPU Job's script"
stub=$(mktemp -d)
cat > "$stub/oc" <<'SH'
#!/usr/bin/env bash
case "$*" in
  "get machinesets -n openshift-machine-api -o name") printf '%b' "$MS" ;;
  get\ machineset.machine.openshift.io/*-o\ json) cat <<'J'
{"metadata":{"name":"c-worker-us-east-2a","uid":"u","resourceVersion":"1","labels":{}},"spec":{"replicas":0,
 "selector":{"matchLabels":{"machine.openshift.io/cluster-api-machineset":"c-worker-us-east-2a"}},
 "template":{"metadata":{"labels":{"machine.openshift.io/cluster-api-machineset":"c-worker-us-east-2a"}},
  "spec":{"providerSpec":{"value":{"instanceType":"m5a.4xlarge","blockDevices":[{"ebs":{"volumeSize":120}}]}}}}},"status":{}}
J
  ;;
  "create -f -") cat > "$CREATED"; echo created ;;
  *) echo "unexpected oc $*" >&2; exit 1 ;;
esac
SH
chmod +x "$stub/oc"
out=$(MS='machineset.machine.openshift.io/c-gpu-l4-us-east-2a\n' CREATED="$stub/c1" PATH="$stub:$PATH" bash -ec "$gpujob" 2>&1) || fail "GPU Job failed with a GPU MachineSet present: $out"
[ ! -e "$stub/c1" ] || fail "GPU Job created a second GPU MachineSet"
out=$(MS='machineset.machine.openshift.io/c-worker-us-east-2a\n' CREATED="$stub/c2" PATH="$stub:$PATH" bash -ec "$gpujob" 2>&1) || fail "GPU Job failed: $out"
python3 -c 'import json,sys; m=json.load(open(sys.argv[1])); s=m["spec"]; p=s["template"]["spec"]
assert m["metadata"]["name"]=="c-gpu-l4-us-east-2a" and s["replicas"]==1
assert p["providerSpec"]["value"]["instanceType"]=="g6.2xlarge" and p["providerSpec"]["value"]["blockDevices"][0]["ebs"]["volumeSize"]==200
assert p["taints"]==[{"key":"nvidia.com/gpu","value":"True","effect":"NoSchedule"}]
assert s["selector"]["matchLabels"]["machine.openshift.io/cluster-api-machineset"]=="c-gpu-l4-us-east-2a"
assert m["metadata"]["labels"]["app.kubernetes.io/part-of"]=="field-content" and "uid" not in m["metadata"] and "status" not in m' "$stub/c2" ||
  fail "GPU Job's MachineSet is not the tainted g6.2xlarge copy"
rm -rf "$stub"

# The GPU Job stops, creating nothing, when listing MachineSets fails.
# Only the first listing fails (a transient error); later calls succeed and could lead to a create.
gstub=$(mktemp -d)
cat > "$gstub/oc" <<'SH'
#!/usr/bin/env bash
case "$*" in
  "get machinesets -n openshift-machine-api -o name") [ -e "$SEEN" ] || { touch "$SEEN"; exit 1; }; printf 'machineset.machine.openshift.io/c-worker-us-east-2a\n' ;;
  get\ machineset.machine.openshift.io/*) echo '{"metadata":{"name":"c-worker-us-east-2a"},"spec":{"selector":{"matchLabels":{}},"template":{"metadata":{"labels":{}},"spec":{"providerSpec":{"value":{"blockDevices":[{"ebs":{}}]}}}}}}' ;;
  "create -f -") touch "$CREATED" ;;
esac
SH
chmod +x "$gstub/oc"; export SEEN="$gstub/seen"
CREATED="$gstub/made" PATH="$gstub:$PATH" bash -ec "$gpujob" >/dev/null 2>&1 && fail "GPU Job succeeded although listing MachineSets failed"
[ ! -e "$gstub/made" ] || fail "GPU Job created a MachineSet after a failed listing"
rm -rf "$gstub"

# The DSC Job patches every DataScienceCluster and fails when a patch fails.
dscjob=$(helm template t automation/argocd/components/order-prep --set partOf=field-content |
  python3 -c 'import json,sys
for l in sys.stdin:
    l = l.strip()
    if l.startswith("command:") and "datasciencecluster" in l: print(json.loads(l[len("command:"):])[2])')
dstub=$(mktemp -d)
printf '#!/usr/bin/env bash\ncase "$*" in "get datasciencecluster -o name") printf "%%b" "$DSCS";; "patch "*) echo "$2" >> "$LOG"; [ "$2" != "${FAILON:-none}" ];; *) exit 1;; esac\n' > "$dstub/oc"; chmod +x "$dstub/oc"
DSCS='datasciencecluster/a\ndatasciencecluster/b\n' LOG="$dstub/log" PATH="$dstub:$PATH" bash -ec "$dscjob" >/dev/null 2>&1 || fail "DSC Job failed"
[ "$(tr '\n' ' ' < "$dstub/log")" = "datasciencecluster/a datasciencecluster/b " ] || fail "DSC Job did not patch every DataScienceCluster"
DSCS='datasciencecluster/a\ndatasciencecluster/b\n' LOG="$dstub/log2" FAILON=datasciencecluster/a PATH="$dstub:$PATH" bash -ec "$dscjob" >/dev/null 2>&1 && fail "DSC Job succeeded although a patch failed"
DSCS='' LOG="$dstub/log3" PATH="$dstub:$PATH" bash -ec "$dscjob" >/dev/null 2>&1 && fail "DSC Job succeeded with no DataScienceCluster"
rm -rf "$dstub"

# verify's GPU check is not fooled by SIGPIPE: oc prints the taint first, then a large output.
oc() { case "$*" in "get nodes"*) echo "nvidia.com/gpu"; seq 1 200000 ;; *) return 1 ;; esac; }
export -f oc
gpuline=$(LAB_APP=x bash automation/verify.sh 2>/dev/null | grep 'a GPU node tainted' || true)
unset -f oc
[ "$gpuline" = "PASS: a GPU node tainted nvidia.com/gpu exists" ] || fail "verify's GPU check fails on a large node list ($gpuline)"
echo "selftest: PASS"
