# Red Hat AI 3-Day Field Enablement Workshop: plan

Working document. Not rendered by Antora.

## Intake

- **Audience:** Red Hat field (SAs, consultants, partners in the Korea GPS workshop) who must be
  able to explain and operate OpenShift AI end to end in front of a customer. Technical depth over
  speed: each module explains the mechanism, has participants write the YAML themselves, and
  proves every claim with an observed field or value.
- **Agenda source:** `korea-workshop.xlsx` (Agenda sheet). Presentations stay in the agenda; this
  repo covers the **lab slots** only (below).
- **Customer questions the labs answer:**
  1. How does OpenShift AI get a GPU to a model, and how is that GPU shared? (DRA)
  2. How do I onboard, register and serve a model my organisation trusts? (Model onboarding)
  3. What does llm-d add over a single vLLM, and how can I see it routing? (llm-d)
  4. How do I offer models as a governed internal service, with keys, tiers, limits and usage? (MaaS)
  5. How do applications and agents consume that service, and how do I see what an agent did? (MaaS app, MLflow tracing)
  6. How do I know a model is good enough, and how do I keep it safe? (EvalHub, NeMo Guardrails)
- **Products (test cluster, 2026-11-02; record installedCSV per module during the live pass):**
  OpenShift 5.0.0-rc.2 (Kubernetes 1.36, `resource.k8s.io/v1`); OpenShift AI 3.5.2 (`rhods-operator.3.5.2`);
  NVIDIA GPU Operator `gpu-operator-certified.v26.7.2` (channel `v26.7`, from the
  `certified-operator-index:v4.20` catalog: the v5.0 certified index does not carry it);
  NFD `stable` (from `redhat-operator-index:v4.20`); OpenShift GitOps 1.22.2; Service Mesh 3.5,
  cert-manager 1.20.1 (pre-installed). To install: RHCL (Kuadrant), Leader Worker Set, Web Terminal.
- **Where / who builds:** RHDP-style **dedicated cluster per participant** (15-20 clusters for the
  event; this sandbox is the test cluster). Argo CD installs the **platform only**: operator
  Subscriptions, the NFD instance, the Showroom. **Participants write and apply every lab
  resource** (NVIDIADriver, GPUCluster, ResourceClaimTemplates, ModelRegistry, InferenceService,
  LLMInferenceService, Kuadrant, Gateway, DSC patches, MaaS CRs, MLflow, EvalHub, NemoGuardrails).
- **Tenancy:** dedicated. **Participant identity:** their own cluster-admin user (`admin` on RHDP;
  `kuro` on the test cluster). **Showroom terminal off** (cluster-admin must not sit behind an
  unauthenticated URL); participants use the console Web Terminal (GitOps installs the operator).
- **Hardware per participant cluster:** 1x GPU node `g6.2xlarge` (1x NVIDIA L4 24 GB, tainted
  `nvidia.com/gpu=True:NoSchedule`), plus CPU workers for the platform and the CPU safety model.
- **Test cluster:** the facilitator's AWS sandbox (OpenShift 5.0 rc). It also hosts the NeMo Guardrails lab
  (`showroom`, `user*-guardrails`, `guardrails-lab-shared`), so this workshop's Showroom lives in
  **`workshop-showroom`** and its namespaces use the `ws-` prefix. Nothing of the guardrails lab is
  touched.
- **Repo:** `https://github.com/hultzj/rhoai-3day-field-workshop` (public).

## Test-cluster changes already made (spike, 2026-11-02)

| Change | Why | Undo |
|---|---|---|
| CatalogSource `certified-operators-v420` | GPU operator missing from the v5.0 certified index | `oc delete catalogsource certified-operators-v420 -n openshift-marketplace` |
| MachineSet `ocp-ai-jz9jq-gpu-l4-us-east-2a` (1x g6.2xlarge, 200 GB, GPU taint) | the GPU node | scale to 0 / delete |
| Subscriptions `nfd`, `gpu-operator-certified`, `rhcl-operator` (in `openshift-auth-operator`), `web-terminal`, labelled part-of this lab | platform | moves under Argo CD at bootstrap |

## Spike findings (verified)

- No GPU and no GPU operator on the cluster as delivered; g6.2xlarge provisions in us-east-2a.
- GPU operator 26.7 offers two stacks: **ClusterPolicy** (classic device plugin, `nvidia.com/gpu`
  extended resource) and **GPUCluster** (`nvidia.com/v1alpha1`, "the DRA-based software-enablement
  stack": NVIDIA DRA driver `dra-driver-nvidia-gpu:v0.5.1`, no device plugin) with the driver from
  an **NVIDIADriver** CR. Day 1 uses the DRA stack.

## Decisions from the spike (2026-11-02, verified on the test cluster)

- **DRA works end to end** on OpenShift 5.0 rc: NFD instance → `NVIDIADriver` (ready in ~4 min) →
  `GPUCluster` → DeviceClasses `gpu.nvidia.com`/`mig.nvidia.com`/`vfio.gpu.nvidia.com` and a
  ResourceSlice for the L4 (`productName: NVIDIA L4`, `memory: 23034Mi`, driver 595.91.7). Exclusive
  template claim blocks a second pod (`cannot allocate all claims`); a standalone claim is shared
  (same GPU UUID in both pods); a standalone claim's allocation is released when no pod reserves it.
- **KServe accepts DRA:** `InferenceService.spec.predictor.resourceClaims` and
  `LLMInferenceService` (v1alpha2) `spec.template.resourceClaims` both work; vLLM 0.24 (RHAII) sees
  the GPU. Node allocatable never shows `nvidia.com/gpu` with the DRA stack.
- **Model for all three days: `granite-4.0-h-tiny-FP8-dynamic`**
  (`oci://registry.redhat.io/rhai/modelcar-granite-4-0-h-tiny-fp8-dynamic:3.0`), tool parser
  `granite4` (18/18 correct tool calls; `hermes` double-encodes arguments). Qwen3-8B-FP8 does not fit
  twice on the L4 (second replica OOM); Phi-4-mini over-triggers tools. Two Granite replicas share
  the L4 at ~10.7 GB each with `--gpu-memory-utilization=0.40 --kv-cache-memory-bytes=3G
  --enforce-eager`; `--enable-prefix-caching` works on this hybrid model (off by default).
- **NFD instance is a participant step** (Module 2 Exercise 1), not GitOps: Argo CD's default
  controller cannot create it, and hardware discovery is a layer worth building.
- **`oc get modelregistry` is ambiguous** (also the OpenShift AI component CR); the guide uses
  `modelregistries.modelregistry.opendatahub.io`.
- **llm-d needs RHCL** (`AuthPolicy` CRD) and `llmisvc-controller-manager` only checks at start-up:
  restart it once if RHCL is installed after OpenShift AI (facilitator known issue).
- **Registry linkage:** InferenceService registry labels do not create a registry
  `inference_services` record (empty after deploy); the guide does not claim it.

## Open risks (each is a spike before its module is written)

1-4. Resolved (see Decisions).
5. MaaS: RHCL 1.4.3 now installed reusing the standalone Authorino (no OLM conflict). Still to
   verify: Kuadrant instance + MaaS on top of it.
6. EvalHub (researched 2026-11-02, not yet run): GA in OpenShift AI 3.5 (LMEvalJob deprecated in its
   favour). `EvalHub` CR `trustyai.opendatahub.io/v1` needs `spec.database.type` (`sqlite` or
   `postgresql`); `providers` default `[garak, garak-kfp, lm-evaluation-harness]` (add `guidellm` to
   use it); `tenancy: single|multi`. No CR for evaluations: REST `POST /api/v1/evaluations/jobs`
   (Bearer token + `X-Tenant: <ns>`), jobs run as plain `batch/v1` Jobs with an auth sidecar. Model
   auth: kube-rbac-proxy InferenceService -> grant the job ServiceAccount `get` on it; MaaS -> Secret
   `api-key` referenced by `model.auth.secret_ref`. Candidate benchmark: `arc_easy`
   (`lm_evaluation_harness`, `num_examples: 50`, `tokenizer: ibm-granite/granite-4.0-h-tiny`
   because the served name is not an HF repo); backup garak `quick` (~2 min). Docs say use a
   dedicated namespace, not `redhat-ods-applications`. MLflow must be enabled (Module 7) for
   results to appear there. Spike before writing Module 8: job SA name, service-CA trust, HF egress,
   payload field `id` vs `benchmark_id`.

## Lab map (lab slots from the agenda)

| Day / slot | Module | Outcome | Time |
|---|---|---|---|
| D1 3:30-4:00 | 1. Your cluster | log in, Web Terminal, pre-flight (`oc whoami`, cluster-admin, GPU node present but no GPU capacity) | 15 min |
| D1 4:00-5:15 | 2. GPUs the DRA way | write NVIDIADriver + GPUCluster; read DeviceClass and ResourceSlice attributes; ResourceClaimTemplate with a CEL selector; exclusive claim blocks a second pod; shared claim lets two pods use one GPU | 40 min |
| D1 | 3. Onboard a model | inspect a Red Hat modelcar; create a ModelRegistry and register the model and version; serve it with vLLM on a claimed GPU (InferenceService, auth on); 401 without a token, 200 with; read vLLM's KV-cache and max-len startup lines | 35 min |
| D2 11:00-12:00 | 4. llm-d | write an LLMInferenceService with the scheduler; inspect the InferencePool, EPP and HTTPRoute it generates; send shared-prefix traffic and see the EPP's prefix-cache scorer pin it to one replica; break a replica and watch routing move | 55 min |
| D2 2:00-2:50 | 5. Stand up MaaS | Postgres + `maas-db-config`; Kuadrant CR; `maas-default-gateway`; DSC `aigateway.modelsAsAService: Managed`; dashboard flags; UWM; before: no MaaS route / after: `maas-api` answers | 50 min |
| D2 3:45-5:15 | 6. Govern and consume MaaS | MaaSModelRef for the llm-d model; two tiers (MaaSSubscription + MaaSAuthPolicy); TelemetryPolicy usage labels; mint keys; 401 / 200 / 429 by tier; usage metrics; consume from a workbench app (OpenAI SDK) and Open WebUI | 80 min |
| D3 1:15-2:00 | 7. Trace an agent with MLflow | enable MLflow (DSC + MLflow CR); in a workbench, write a small tool-calling agent on the MaaS model with `mlflow.openai.autolog()`; read the trace spans, tokens and latency; an invalid key shows up as an error span | 45 min |
| D3 2:00-2:30 | 8. Evaluate with EvalHub | create an EvalHub; run a small benchmark against the MaaS model; read the scores and what they do not prove | 30 min |
| D3 3:10-4:00 | 9. Guard it with NeMo Guardrails | port of `nemo-guardrails-eval-lab` Modules 1-3 for a dedicated cluster: NemoGuardrails CR (regex + content-safety), auth-protected route, labelled-set evaluation (P/R/F1) | 50 min |
| Day 4 (optional) | Zero Trust Workload Identity Manager | out of scope for now (agenda: "might need/want to add") | - |

Each module follows the skill's template (why, glossary, technical context, objectives, exercises
with Expected results, a negative control or break-and-restore, evidence checkpoint).

## Status (2026-11-02)

- Day 1 (Modules 1-3): written, reviewed (xreview: 3 rounds on the draft + 3 rounds on the
  verification changes), verified live as `kuro`, clean teardown/re-bootstrap/re-walk passed, CI green,
  published at https://hultzj.github.io/rhoai-3day-field-workshop/.
- Day 2: blocked until `llmisvc-controller-manager` is restarted (it cached "no AuthPolicy CRD" from
  before RHCL was installed); the restart was denied to the agent and is with the cluster owner.
- Test-cluster leftover: registry record `probe-create-path` (UNDEPLOYED) from testing Exercise 6's
  create path; the registry API refuses deletes (405), so it goes with the registry at cleanup.

## Build order

1. Resolve open risks 1-4 on the test cluster (GPU/DRA/serving), then write and live-verify Day 1.
2. Day 2 (risks 3, 5), then Day 3 (risk 6; reuse the guardrails lab's verified content).
3. Each day: `npm run build`, `check-lab.sh --draft`, xreview, live walk as `kuro`, strict check, push.
4. Final: teardown + clean re-run of the whole workshop on the test cluster; facilitator guide with
   the RHDP order shape (GPU node, sizing) and per-participant cost.
