#!/usr/bin/env bash
# Facilitator readiness check: one PASS/FAIL line per lab prerequisite.
set -uo pipefail

GITOPS_NS=${GITOPS_NS:-openshift-gitops}
SHOWROOM_NS=${SHOWROOM_NS:-workshop-showroom}
# The parent Application name; children are named <LAB_APP>-<component>. An RHDP order always names
# it field-content; make bootstrap uses bootstrap.yaml's name.
# The bootstrap parent wins when both exist, so an unrelated field-content cannot hide it.
if [[ -z ${LAB_APP:-} ]]; then
  LAB_APP=rhoai-3day-field-workshop
  if [[ -z $(oc -n "$GITOPS_NS" get applications.argoproj.io "$LAB_APP" -o name --ignore-not-found 2>/dev/null) &&
        -n $(oc -n "$GITOPS_NS" get applications.argoproj.io field-content -o name --ignore-not-found 2>/dev/null) ]]; then
    LAB_APP=field-content
  fi
fi
# The participant's user (they act as themselves, a cluster-admin): PARTICIPANT=<user> make verify.
PARTICIPANT=${PARTICIPANT:-}
failed=0

check() {
  local name=$1
  shift
  if "$@" >/dev/null 2>&1; then
    echo "PASS: $name"
  else
    echo "FAIL: $name"
    failed=1
  fi
}

apps_synced_healthy() {
  local apps
  apps=$(oc -n "$GITOPS_NS" get applications.argoproj.io \
    -l demo.redhat.com/application=field-content \
    -o jsonpath='{range .items[*]}{.metadata.name} {.status.sync.status}/{.status.health.status} {.metadata.labels.app\.kubernetes\.io/part-of}{"\n"}{end}') || return 1
  # This lab's Applications carry part-of=<LAB_APP>: the showroom child must exist, and all must be Synced/Healthy.
  awk -v app="$LAB_APP" '
    $1 != app && $3 != app { next }  # the parent by name: RHDP creates it without the label
    $1 == app { p = 1 }  # the parent: missing children or a missing parent must fail
    $1 == app "-showroom" { s++ }
    $1 == app "-platform" { s++ }
    $2 != "Synced/Healthy" { bad = 1 }
    END { exit !(p && s == 2 && !bad) }
  ' <<<"$apps"
}

showroom_answers() {
  local host
  host=$(oc -n "$SHOWROOM_NS" get route showroom -o jsonpath='{.spec.host}') || return 1
  curl -fsk --max-time 10 -o /dev/null "https://$host"
}

# Every url: tab in ui-config.yml is an iframe: its target must answer 2xx (after redirects) and allow
# framing. A default OpenShift console sends X-Frame-Options: DENY and renders as a blank tab; RHDP
# orders embed it, elsewhere drop the tab or get the cluster owner's OK. Report-only CSP is ignored.
frameable() {
  local headers last csp
  headers=$(curl -skIL --max-time 10 "$1") || return 1
  last=$(awk '/^HTTP\// {b = ""} {b = b $0 "\n"} END {printf "%s", b}' <<<"$headers" | tr -d '\r')
  grep -qE '^HTTP/[0-9.]+ 2[0-9][0-9]' <<<"$last" || return 1
  ! grep -qi '^x-frame-options:' <<<"$last" || return 1
  # Browsers enforce every policy, so every enforced frame-ancestors directive (across headers and
  # comma-separated policies) must contain a bare * source; a scoped wildcard (https://*.x) is not enough.
  csp=$(grep -i '^content-security-policy:' <<<"$last" | cut -d: -f2- || true)  # none is fine
  tr ',;' '\n\n' <<<"$csp" |
    awk '{d = tolower($0); sub(/^[ \t]+/, "", d)} d ~ /^frame-ancestors/ && d !~ /(^| )\*( |$)/ {bad = 1} END {exit bad}'
}

check "lab Applications are Synced/Healthy" apps_synced_healthy
check "Showroom route answers" showroom_answers
ui_config="$(dirname "$0")/../ui-config.yml"
if [[ ! -r $ui_config ]]; then
  check "ui-config.yml is readable (its url: tabs are checked)" false
else
  domain=$(oc get ingresses.config.openshift.io cluster -o jsonpath='{.spec.domain}' 2>/dev/null || true)
  for url in $(awk '{sub(/^[[:space:]]*-[[:space:]]*/, "")} $1 == "url:" {print $2}' "$ui_config" | tr -d "'\""); do
    url=$(sed "s|\${DOMAIN}|$domain|g" <<<"$url")
    check "Showroom tab $url can embed (2xx, framing allowed)" frameable "$url"
  done
fi

csv_succeeded() {  # $1: package name; any namespace
  oc get csv -A --no-headers 2>/dev/null | awk -v p="$1" '$2 ~ "^"p"\\." && $NF == "Succeeded" {f = 1} END {exit !f}'
}
for pkg in nfd gpu-operator-certified rhcl-operator web-terminal rhods-operator; do
  check "operator $pkg installed (CSV Succeeded)" csv_succeeded "$pkg"
done
dsc_ready() {
  local c
  c=$(oc get datasciencecluster -o jsonpath='{range .items[0].status.conditions[?(@.status=="True")]}{.type} {end}') || return 1
  [[ " $c " == *" Ready "* && " $c " == *" KserveReady "* && " $c " == *" ModelRegistryReady "* ]]
}
check "DataScienceCluster Ready with KServe and Model Registry" dsc_ready
check "DRA API resource.k8s.io/v1 is served (Kubernetes 1.34+)" oc get --raw /apis/resource.k8s.io/v1
trustyai_ready() { [ "$(oc get datasciencecluster -o jsonpath='{.items[0].status.conditions[?(@.type=="TrustyAIReady")].status}')" = True ]; }
check "TrustyAI Ready (EvalHub and NeMo Guardrails, Day 3)" trustyai_ready
check "EvalHub and NemoGuardrails APIs present" oc get crd evalhubs.trustyai.opendatahub.io nemoguardrails.trustyai.opendatahub.io
gpu_node() { oc get nodes -o custom-columns=T:.spec.taints[*].key,I:.metadata.labels.node\\.kubernetes\\.io/instance-type --no-headers | grep -q 'nvidia.com/gpu'; }
check "a GPU node tainted nvidia.com/gpu exists" gpu_node
no_cluster_policy() { out=$(oc get clusterpolicies.nvidia.com -o name --ignore-not-found) || return 1; [[ -z $out ]]; }
check "no ClusterPolicy (Module 2 builds the DRA stack instead)" no_cluster_policy
check "vLLM CUDA runtime template present" oc get template vllm-cuda-runtime-template -n redhat-ods-applications
# Module 3 has participants write the ServingRuntime with the image pinned in content/antora.yml.
runtime_image_matches() {
  local want got
  want=$(awk -F"'" '/^    vllm_image:/ {print $2}' "$(dirname "$0")/../content/antora.yml")
  got=$(oc process -n redhat-ods-applications vllm-cuda-runtime-template -o jsonpath='{.items[0].spec.containers[0].image}') || return 1
  [[ -n $want && $want == "$got" ]]
}
check "guide's vllm_image equals the OpenShift AI runtime template image" runtime_image_matches
catalog_has_model() {
  oc exec -n rhoai-model-registries deploy/model-catalog -c catalog -- \
    curl -s "http://localhost:8080/api/model_catalog/v1alpha1/models?q=granite-4.0-h-tiny-FP8&pageSize=5" | grep -q 'granite-4.0-h-tiny-FP8-dynamic'
}
check "model catalog lists granite-4.0-h-tiny-FP8-dynamic" catalog_has_model
default_sc() { oc get sc -o jsonpath='{range .items[*]}{.metadata.annotations.storageclass\.kubernetes\.io/is-default-class}{"\n"}{end}' | grep -qx true; }
check "a default StorageClass exists" default_sc
if [[ -n $PARTICIPANT ]]; then
  check "participant $PARTICIPANT is cluster-admin" \
    bash -c "[ \"\$(oc auth can-i '*' '*' --all-namespaces --as '$PARTICIPANT' --as-group system:authenticated --as-group system:authenticated:oauth)\" = yes ]"
else
  echo "SKIP: participant rights (set PARTICIPANT=<user>)"
fi

exit "$failed"
