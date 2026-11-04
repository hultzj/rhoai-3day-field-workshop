# Red Hat AI 3-Day Field Enablement Workshop

Hands-on labs for a three-day Red Hat field enablement event on **Red Hat OpenShift AI**: from a
bare GPU node to a governed, observed, evaluated and guarded AI service, built by the participant one
layer at a time. Participants write and apply every lab resource themselves; each exercise states
the result the cluster must show, and every step has been run on a live cluster.

**Read the guide:** <https://hultzj.github.io/rhoai-3day-field-workshop/> (RHDP Showroom format,
Antora/AsciiDoc). Each exercise embeds a short video of that step run on the test cluster.

## Lab map

| Day | Module | Outcome | Time |
|---|---|---|---|
| 1 | 1. Your cluster | identity, rights and an inventory: a GPU node that nothing can use yet | 15 min |
| 1 | 2. GPUs the DRA way | NVIDIA driver and DRA stack; the GPU claimed by property, exclusively and shared | 40 min |
| 1 | 3. Onboard a model | catalog → model registry → authenticated vLLM on a claimed GPU; 401 / 403 / 200 | 35 min |
| 2 | 4. llm-d | two replicas behind llm-d's scheduler; routing decisions observed | 55 min |
| 2 | 5. Stand up MaaS | Kuadrant (Red Hat Connectivity Link), gateway and Models-as-a-Service | 50 min |
| 2 | 6. Govern and consume MaaS | tiers, API keys, 401 / 200 / 429, usage telemetry; consumed by an application | 80 min |
| 3 | 7. Trace an agent with MLflow | a tool-calling agent's spans, tokens and latency in MLflow | 45 min |
| 3 | 8. Evaluate with EvalHub | a benchmark run against the MaaS model, and what it does and does not prove | 30 min |
| 3 | 9. Guard it with NeMo Guardrails | an authenticated guardrails endpoint, measured against a labelled prompt set | 50 min |

Presentations are separate; this repository covers the lab slots of the event agenda.

## What each participant cluster needs

One dedicated cluster per participant (RHDP), each with:

- OpenShift 4.21 or later with OpenShift GitOps (DRA's `resource.k8s.io/v1` API)
- OpenShift AI 3.5 with `kserve`, `modelregistry`, `dashboard` and `trustyai` Managed
- one GPU node: AWS `g6.2xlarge` (1x NVIDIA L4 24 GB), tainted `nvidia.com/gpu=True:NoSchedule`
  (`automation/gpu-machineset.sh` adds one on AWS)
- a default StorageClass and a cluster-admin user per participant
- no NVIDIA `ClusterPolicy` or device plugin on the GPU node (Module 2 builds the DRA stack itself)

The full checklist, with a check command for each item, is in the guide's
[Facilitator Guide](https://hultzj.github.io/rhoai-3day-field-workshop/modules/92-facilitator-guide.html).

## Deploy

Argo CD installs the **platform only**: the operator Subscriptions (NFD, NVIDIA GPU Operator, Red Hat
Connectivity Link, Web Terminal), the NFD instance and the Showroom guide. Everything the labs build
is left to the participant.

- **RHDP:** order the Field Content CI with this repository and the path `automation/argocd`.
- **Any other OpenShift cluster**, from a cluster-admin shell in a checkout of this repository:

```bash
make -C automation bootstrap          # PROFILE=<name> adds automation/argocd/values-<name>.yaml
make -C automation status             # repeat until every Application is Synced and Healthy
make -C automation verify             # every line must print PASS before class
```

`values-sandbox-ocp5.yaml` is the profile for OpenShift 5.0 pre-release clusters (extra v4.20
catalog for the GPU Operator and NFD; RHCL next to an existing standalone Authorino).

## Clean up

- **Participants:** the guide's *Cleanup* page removes what the labs created, day by day.
- **Facilitator:** `make -C automation teardown` removes the Applications, exactly the operators the
  lab's Subscriptions installed (and the dependency operators OLM added with them), and the
  namespaces the lab created. It is safe to re-run if it stops part way.

## Repository layout

| Path | What |
|---|---|
| `content/` | the guide: Antora component, pages in `modules/ROOT/pages/`, videos and images in `modules/ROOT/assets/images/` |
| `automation/` | Argo CD chart (`argocd/`), `Makefile` (bootstrap, status, verify, teardown), GPU MachineSet helper, teardown helpers and their self-test |
| `scripts/check-lab.sh` | guide checks (structure, attributes, every embedded video present) |
| `scripts/videos/` | the recorder that runs every exercise as the participant and produces the step videos (see its README) |
| `PLAN.md` | the design and test notes behind the labs |

## Develop and check

```bash
npm ci && npm run build               # build the guide into www/
bash scripts/check-lab.sh             # guide checks
bash automation/tests/selftest.sh     # automation self-test (offline)
(cd scripts/videos && npm ci && npm test)   # recorder step checks (offline)
```

The step videos are recorded by running the whole workshop on a live cluster; a step whose expected
output does not appear produces no video. See [`scripts/videos/README.md`](scripts/videos/README.md).

## Tested on

OpenShift 5.0.0-rc.2 (Kubernetes 1.36), OpenShift AI 3.5.2, NVIDIA GPU Operator 26.7.2 with the DRA
driver, on an AWS cluster with one NVIDIA L4, as a single participant. The model is Granite 4.0 H
Tiny (FP8) from the Red Hat AI validated model catalog.
