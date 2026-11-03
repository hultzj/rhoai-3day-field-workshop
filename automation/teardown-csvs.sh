#!/usr/bin/env bash
# Teardown helper for the operator CSVs this lab installed. OLM keeps a CSV when its Subscription is
# deleted, and that orphan blocks the next bootstrap's Subscription (ResolutionFailed).
#   record  before the Applications are deleted: save "<namespace> <csv>" for every Subscription
#           labelled part-of=<app>, plus "sub <namespace> <name>" and its CSV for every dependency
#           Subscription OLM generated for one of them (name <package>-<channel>-<source>-<sourceNS>,
#           same namespace, created within 3 minutes after it (not the same second), no part-of label, and its package one of
#           the dependencies of that Subscription's package, per $DEPENDENCY_PACKAGES). A dependency left
#           behind auto-upgrades and can make the next bootstrap's Subscription unresolvable.
#   delete  after: delete exactly the recorded CSVs, then the record. The record survives a failed
#           delete, so re-running teardown finishes the job.
# Usage: teardown-csvs.sh record|delete <lab app name>
set -euo pipefail
mode=$1 app=$2
# <lab package>=<its OLM dependencies>: RHCL needs Authorino, Limitador and the DNS operator; the Web
# Terminal needs DevWorkspace.
DEPENDENCY_PACKAGES=${DEPENDENCY_PACKAGES:-rhcl-operator=authorino-operator,limitador-operator,dns-operator web-terminal=devworkspace-operator}
cm=$app-installed-csvs ns=openshift-gitops

case "$mode" in
record)
  all_subs=$(oc get subscriptions.operators.coreos.com -A -o json)
  new=$(jq -r --arg app "$app" --arg deps "$DEPENDENCY_PACKAGES" '
    def ts: sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601;
    ($deps | split(" ") | map(select(. != "") | split("=") | {key: .[0], value: (.[1] // "" | split(","))}) | from_entries) as $dm
    | [.items[] | select(.metadata.labels["app.kubernetes.io/part-of"] == $app)] as $lab
    | ($lab[] | select(.status.installedCSV) | "\(.metadata.namespace) \(.status.installedCSV)"),
      (.items[] as $d | $lab[] as $l
       | select($d.metadata.namespace == $l.metadata.namespace and $d.metadata.name != $l.metadata.name
                and (($d.metadata.labels // {})["app.kubernetes.io/part-of"] == null)
                and (($dm[$l.spec.name] // []) | index($d.spec.name) != null)
                and ($d.metadata.name == "\($d.spec.name)-\($d.spec.channel)-\($d.spec.source)-\($d.spec.sourceNamespace)")
                and (($d.metadata.creationTimestamp | ts) - ($l.metadata.creationTimestamp | ts) | . > 0 and . <= 180))
       | "sub \($d.metadata.namespace) \($d.metadata.name)", (select($d.status.installedCSV) | "\($d.metadata.namespace) \($d.status.installedCSV)"))
  ' <<<"$all_subs")
  old=$(oc get configmap "$cm" -n "$ns" --ignore-not-found -o jsonpath='{.data.csvs}')
  all=$(printf '%s\n%s\n' "$old" "$new" | awk 'NF == 2 || (NF == 3 && $1 == "sub")' | sort -u)
  [[ -n $all ]] || exit 0
  oc create configmap "$cm" -n "$ns" --from-literal=csvs="$all" --dry-run=client -o yaml | oc apply -f - >/dev/null
  ;;
delete)
  list=$(oc get configmap "$cm" -n "$ns" --ignore-not-found -o jsonpath='{.data.csvs}')
  failed=0
  while read -r a b c; do  # dependency Subscriptions first, so OLM does not reinstall what we delete
    [[ $a == sub && -n $c ]] || continue
    echo "deleting dependency Subscription $b/$c (created by OLM for this lab's Subscription)"
    oc delete subscriptions.operators.coreos.com "$c" -n "$b" --ignore-not-found || failed=1
  done <<<"$list"
  while read -r csvns csv rest; do
    [[ -n $csv && $csvns != sub ]] || continue
    echo "deleting CSV $csvns/$csv (installed for this lab)"
    oc delete csv "$csv" -n "$csvns" --ignore-not-found || failed=1
  done <<<"$list"
  [[ $failed -eq 0 && -n $list ]] && oc delete configmap "$cm" -n "$ns" --ignore-not-found >/dev/null
  exit "$failed"
  ;;
*) echo "usage: $0 record|delete <lab app name>" >&2; exit 2 ;;
esac
