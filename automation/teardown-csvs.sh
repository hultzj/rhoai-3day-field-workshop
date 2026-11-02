#!/usr/bin/env bash
# Teardown helper for the operator CSVs this lab installed. OLM keeps a CSV when its Subscription is
# deleted, and that orphan blocks the next bootstrap's Subscription (ResolutionFailed).
#   record  before the Applications are deleted: save "<namespace> <csv>" for every Subscription
#           labelled part-of=<app> (only CSVs this lab's Subscriptions installed) in a ConfigMap
#   delete  after: delete exactly the recorded CSVs, then the record. The record survives a failed
#           delete, so re-running teardown finishes the job.
# Usage: teardown-csvs.sh record|delete <lab app name>
set -euo pipefail
mode=$1 app=$2
cm=$app-installed-csvs ns=openshift-gitops

case "$mode" in
record)
  new=$(oc get subscriptions.operators.coreos.com -A -l "app.kubernetes.io/part-of=$app" \
    -o jsonpath='{range .items[*]}{.metadata.namespace} {.status.installedCSV}{"\n"}{end}' | awk 'NF == 2')
  old=$(oc get configmap "$cm" -n "$ns" --ignore-not-found -o jsonpath='{.data.csvs}')
  all=$(printf '%s\n%s\n' "$old" "$new" | awk 'NF == 2' | sort -u)
  [[ -n $all ]] || exit 0
  oc create configmap "$cm" -n "$ns" --from-literal=csvs="$all" --dry-run=client -o yaml | oc apply -f - >/dev/null
  ;;
delete)
  list=$(oc get configmap "$cm" -n "$ns" --ignore-not-found -o jsonpath='{.data.csvs}')
  failed=0
  while read -r csvns csv; do
    [[ -n $csv ]] || continue
    echo "deleting CSV $csvns/$csv (installed by this lab's Subscription)"
    oc delete csv "$csv" -n "$csvns" --ignore-not-found || failed=1
  done <<<"$list"
  [[ $failed -eq 0 && -n $list ]] && oc delete configmap "$cm" -n "$ns" --ignore-not-found >/dev/null
  exit "$failed"
  ;;
*) echo "usage: $0 record|delete <lab app name>" >&2; exit 2 ;;
esac
