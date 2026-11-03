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
   results to appear there.
   **Spike verified (2026-11-02, as `kuro`, namespace `ws-eval`):** `EvalHub` `v1` with
   `tenancy: single`, `database: {type: sqlite}`, `providers: [lm-evaluation-harness, garak]` is
   Ready in ~20 s (route `evalhub`, job SA `evalhub-ws-eval-job`). `/api/v1/health` is open; jobs API
   401 without a token. Benchmark entries use `id` + `provider_id`. Against the Day 1
   InferenceService (`https://granite4-tiny-predictor.ws-models.svc.cluster.local:8443/v1`):
   without a CA the job fails `502` (proxy log `tls: bad certificate`); with a Secret `granite-ca`
   holding key `ca_cert` (the `openshift-service-ca.crt` ConfigMap) referenced by
   `model.auth.secret_ref` and a RoleBinding giving the job SA `get` on the InferenceService,
   `arc_easy` 50 examples completes in 48 s: `acc 0.60`, `acc_norm 0.62` (stderr 0.07), default
   test threshold 0.5 -> `pass: true`. Without the RoleBinding: `403` and the proxy logs
   `Forbidden (user=system:serviceaccount:ws-eval:evalhub-ws-eval-job ...)`. HF egress worked.

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

## llm-d spike (2026-11-03, as `kuro`) for Module 4

- `llmisvc-controller-manager` restarted (cluster owner OK) -> AuthPolicy precondition passes.
- `LLMInferenceService` v1alpha2 `granite4-tiny` in `ws-models`, 2 replicas on standalone claim
  `shared-l4`, `router: {gateway: {}, route: {}, scheduler: {}}`: first fails `RefsInvalid: Managed
  HTTPRoute references non-existent Gateway openshift-ingress/openshift-ai-inference`. Participant
  creates that Gateway with the cluster's existing pattern: ConfigMap `openshift-ai-inference-config`
  (ClusterIP Service + service-CA serving cert `openshift-ai-inference-tls`), Gateway on
  `data-science-gateway-class` (HTTPS 443, `allowedRoutes: All`), reencrypt Route
  `inference.<domain>` -> Service `openshift-ai-inference-data-science-gateway-class`. Then Ready in
  ~3 min: 2 vLLM pods, `granite4-tiny-kserve-router-scheduler` (EPP), InferencePool
  `granite4-tiny-inference-pool`, HTTPRoute `granite4-tiny-kserve-route`; URL
  `https://inference.<domain>/ws-models/granite4-tiny`; served names `granite4-tiny` and
  `publishers/ws-models/models/granite4-tiny`.
- KServe creates AuthPolicy `openshift-ai-inference-authn` on the Gateway, but with no Kuadrant
  instance it is `Enforced=False MissingResource: kuadrant is not installed`; anonymous calls get 200.
  Module 5's Kuadrant CR should flip this (verify).
- EPP config (from its args): scorers queue 2, kv-cache-utilization 2, prefix-cache 3, no-hit-lru 2,
  max-score-picker; approximate prefix matching (block 64 tokens after override).
- Routing evidence: 5 requests with ~1.5k-token system prompt "alpha" and 5 with "beta": each prefix
  family landed entirely on one replica (per-pod `vllm:request_success_total` +5 each), and each
  replica's `vllm:prefix_cache_hits_total` rose to 4096 (first request misses, the next four hit).
  Metrics: `oc exec <pod> -c main -- curl -sk https://localhost:8000/metrics`.

## MaaS spike (2026-11-03, as `kuro`) for Modules 5-6

Module 5 (stand up), in order, all verified:
1. Secrets `postgres-creds` (`POSTGRESQL_USER/PASSWORD/DATABASE=maas`) and `maas-db-config`
   (`DB_CONNECTION_URL=postgresql://maas:<pw>@postgres:5432/maas?sslmode=disable`) in
   `redhat-ods-applications` (password from `openssl rand -hex 16`, never in git), then PostgreSQL:
   `registry.redhat.io/rhel9/postgresql-15@sha256:24320a40760f17f867aa1d05f0f82268008ac537f502de83a2b477c19bc3e2ad`,
   5Gi PVC, Service `postgres`.
2. `Kuadrant` `kuadrant` in `kuadrant-system` (`observability.enable: true`) -> Authorino + Limitador
   pods, Ready in ~20 s. This flips Module 4's AuthPolicy to `Enforced=True` - but every call
   returns **500** (wasm: `gRPC status code is not OK`): OpenShift AI's EnvoyFilter
   `openshift-ai-inference-authn-ssl` calls Authorino :50051 over TLS (trusting the service CA)
   while the Authorino listener has TLS off. Fix (3.5; the 3.4 source lab said the opposite):
   annotate Service `authorino-authorino-authorization`
   `service.beta.openshift.io/serving-cert-secret-name=authorino-server-cert`, patch Authorino
   `spec.listener.tls: {enabled: true, certSecretRef: {name: authorino-server-cert}}` -> llm-d
   endpoint: anonymous 401, token 200, bad token 401. The 3.4 Authorino service-CA trust volume patch
   was not needed.
3. Gateway `maas-default-gateway` (`openshift-ingress`, labels `kuadrant.io/gateway: "true"`,
   `opendatahub.io/managed: "false"`, annotation `security.opendatahub.io/authorino-tls-bootstrap`)
   on `data-science-gateway-class`, listener `hostname: maas.<domain>`, cert `router-certs-default`,
   **LoadBalancer** (no parametersRef): on AWS it gets an ELB, and the ingress operator publishes a
   DNSRecord `maas.<domain>` -> ELB automatically. No svc-status patch, no hostAliases (the source
   lab's unsupported workarounds are only for clusters without a LB). (Laptop DNS lagged; tested with
   `curl --resolve`.)
4. DSC `aigateway: {managementState: Managed, modelsAsAService: {managementState: Managed}}` ->
   `AIGatewayReady=True`; `maas-controller` (redhat-ods-applications), `maas-api`
   (`redhat-ai-gateway-infra`), namespace `models-as-a-service`, AuthPolicy `maas-gateway-auth`.
   `GET https://maas.<domain>/maas-api/v1/models`: anonymous 401, token 200 `{"data":[]}`.
5. User-workload monitoring was off: `cluster-monitoring-config` `enableUserWorkload: true`.
   TelemetryPolicy `maas-telemetry` on the gateway (labels model/user/subscription/org/cost centre).

Module 6 (publish, govern, consume), verified:
- Recreate the `LLMInferenceService` with `router.gateway.refs: [maas-default-gateway]` and
  `--enable-force-include-usage` (recreate, not patch: a rolling update needs a third vLLM on the GPU).
  URL `https://maas.<domain>/ws-models/granite4-tiny`.
- `MaaSModelRef granite4-tiny` (ws-models): `Ready`, `GovernanceAttached` ("Active governance
  pairing found"). `MaaSSubscription granite-gold` (20000 tokens/1m) and `granite-bronze` (300/1m),
  owner group `system:authenticated:oauth`, `tokenMetadata` set; `MaaSAuthPolicy granite-access`.
  All in `models-as-a-service`.
- `POST /maas-api/v1/api-keys {name, expiresIn: 2h, subscription}` -> `sk-oai-…` per tier.
  `/maas-api/v1/models` with a key lists `publishers/ws-models/models/granite4-tiny`.
- Path routing `POST /ws-models/granite4-tiny/v1/chat/completions` with key -> 200 + usage; no key 401.
- Same 12-request burst: bronze `200 x5 then 429 x7`; gold `200 x12`.
- Prometheus (thanos-querier): `sum by (subscription,user)(authorized_hits)` ->
  `granite-gold/kuro 378` tokens; `limited_calls` 7; `authorized_calls` by subscription;
  `vllm:generation_tokens_total`. Labels only on traffic after the TelemetryPolicy existed.

## MLflow spike (2026-11-02, as `kuro`) for Module 7

- DSC `spec.components.mlflowoperator.managementState: Managed` -> `MLflowOperatorReady=True` in
  ~20 s; CRDs `mlflows.mlflow.opendatahub.io` (v1), `mlflowconfigs.mlflow.kubeflow.org`.
- `MLflow` `mlflow` (cluster-scoped; the operator deploys into `redhat-ods-applications`) with
  `backendStoreUri`/`registryStoreUri: sqlite:////mlflow/mlflow.db`, `serveArtifacts: true`,
  `artifactsDestination: file:///mlflow/artifacts`, `storage` 5Gi RWO: a migration Job runs first,
  then `Available`, `status.version: 3.14.0`, URL `https://rh-ai.<domain>/mlflow`, in-cluster
  `https://mlflow.redhat-ods-applications.svc:8443/mlflow`.
- Tracking API: anonymous -> 302 (login); with a bearer token it needs a workspace:
  `X-MLFLOW-WORKSPACE: <project>` (workspace = OpenShift project), else
  `INVALID_PARAMETER_VALUE: Workspace context is required`.
- MLflow authorization is Kubernetes RBAC on virtual resources (`mlflow.kubeflow.org`
  experiments/datasets/registeredmodels) in the workspace namespace: a workload SA needs a RoleBinding
  to ClusterRole `mlflow-operator-mlflow-integration` (there are also `-view`/`-edit`).
- **Agent spike verified:** Job in `ws-models` (image `s2i-minimal-notebook:3.5`, `pip install
  mlflow==3.14.0 openai`), SA with RoleBindings to `mlflow-operator-mlflow-integration` and to a
  `get inferenceservices/granite4-tiny` Role; env `MLFLOW_WORKSPACE=ws-models`,
  `MLFLOW_TRACKING_SERVER_CERT_PATH=<SA service-ca.crt>` (without it: SSLCertVerificationError),
  `MLFLOW_TRACKING_TOKEN=<SA token>`; OpenAI client to the InferenceService with the SA token and
  service CA. `mlflow.openai.autolog()` + `@mlflow.trace` agent/tool spans: experiment
  `weather-agent` created, the model called `get_weather`, answered from the tool result; trace
  `status OK`, 959 ms, name `agent`. Reading the trace in-process right away fails ("span data is
  corrupted") because export is async: call `mlflow.flush_trace_async_logging()` first.
- Spike state reverted afterwards (MLflow CR deleted, DSC back to Removed) so Module 7's live walk
  starts from the participant's starting point.

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
