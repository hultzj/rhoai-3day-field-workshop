#!/usr/bin/env bash
# Facilitator prerequisite (AWS clusters): add the workshop's GPU node by copying a worker
# MachineSet, switching it to g6.2xlarge (1x NVIDIA L4), tainting it nvidia.com/gpu and scaling to 1.
# Usage: bash automation/gpu-machineset.sh [source-machineset]   (default: the first worker MachineSet)
set -euo pipefail
NS=openshift-machine-api
INSTANCE=${INSTANCE:-g6.2xlarge}
src=${1:-$(oc get machinesets -n "$NS" -o name | grep -m1 worker | cut -d/ -f2)}
[[ -n $src ]] || { echo "no worker MachineSet found; pass one as the first argument" >&2; exit 1; }
# Same test as the order-prep Job, so a MachineSet it created (part-of=field-content) counts too.
existing=$(oc get machinesets -n "$NS" -o name | grep -- '-gpu-l4' || true)
[[ -z $existing ]] || { echo "already present: $existing"; exit 0; }
manifest=$(oc get machineset "$src" -n "$NS" -o json | jq --arg inst "$INSTANCE" '
  (.metadata.name | if test("-worker-") then sub("-worker-"; "-gpu-l4-") else . + "-gpu-l4" end) as $name
  | del(.metadata.uid, .metadata.resourceVersion, .metadata.creationTimestamp, .metadata.generation,
        .metadata.managedFields, .metadata.annotations, .status)
  | .metadata.name = $name
  | .metadata.labels["app.kubernetes.io/part-of"] = "rhoai-3day-field-workshop"
  | .spec.replicas = 1
  | .spec.selector.matchLabels["machine.openshift.io/cluster-api-machineset"] = $name
  | .spec.template.metadata.labels["machine.openshift.io/cluster-api-machineset"] = $name
  | .spec.template.spec.taints = [{"key": "nvidia.com/gpu", "value": "True", "effect": "NoSchedule"}]
  | .spec.template.spec.providerSpec.value.instanceType = $inst
  | .spec.template.spec.providerSpec.value.blockDevices[0].ebs.volumeSize = 200')
jq '{name: .metadata.name, instanceType: .spec.template.spec.providerSpec.value.instanceType,
     zone: .spec.template.spec.providerSpec.value.placement.availabilityZone, taints: .spec.template.spec.taints}' <<<"$manifest"
read -r -p "Create this MachineSet (one $INSTANCE, billed while it runs)? [y/N] " ok
[[ $ok == y || $ok == Y ]] || { echo "not created"; exit 1; }
oc create -f - <<<"$manifest"
