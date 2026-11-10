// The workshop's step videos, one per exercise, recorded module by module in guide order. Every
// `expect` must find its text on screen, or the exercise fails and produces no video: a recording
// cannot show a step that did not give the guide's expected result.
import { sleep } from "./lib.mjs";

const T = (re, label, kind = "ok") => ({ re, label, kind });
// Module 4 Exercise 6: on each of the two replicas, requests grew by exactly 5 and prefix-cache hits grew.
export function routedByPrefix(text) {
  const [, before = "", after] = text.split(/^(?:BEFORE|AFTER)\s*$/m);
  if (after === undefined) return false;
  const read = (x) => Object.fromEntries([...x.matchAll(/^(\S+) requests=(\d+) prefix_cache_hits=(\d+)/gm)].map((m) => [m[1], [+m[2], +m[3]]]));
  const b = read(before), a = read(after), pods = Object.keys(a);
  return pods.length === 2 && pods.every((p) => b[p] && a[p][0] - b[p][0] === 5 && a[p][1] > b[p][1]);
}
// Cleanup blocks must not print an oc error (their deletes are independent commands).
const NO_OC_ERROR = { absent: "^(Error from server|error: )", why: "a delete failed (oc printed an error)" };
// The participant recording the videos (the same LAB_USER login.mjs signed in), as a regex literal.
const USER = (process.env.LAB_USER || "kuro").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// --- GUI helpers (dashboard and console) -------------------------------------------------------
async function dashboard(s, path) {
  const p = await s.cam("dash");
  s.take.cut();
  await p.goto(`${s.cfg.dashboard}${path}`, { waitUntil: "domcontentloaded" });
  await dismissModals(p);
  s.take.normal();
  return p;
}
// The dashboard's welcome tour (or any other modal) can open several seconds after the page: watch for
// one for 15 seconds and dismiss it (its Close button, else Escape), off camera.
async function dismissModals(p) {
  for (let i = 0; i < 15; i++) {
    const modal = p.locator(".pf-v6-c-backdrop, [role=dialog]").filter({ visible: true }).first();
    if (await modal.count()) {
      const close = modal.getByRole("button", { name: /^Close$|^Skip|^Not now|^Dismiss/i }).first();
      if (await close.isVisible().catch(() => false)) await close.click().catch(() => {}); else await p.keyboard.press("Escape");
      await sleep(1000);
      continue;
    }
    await sleep(1000);
  }
}

// Open a dashboard page, reloading off camera until its main text matches `re` (a dashboard setting
// such as a feature flag takes up to a minute to reach the page).
async function dashUntil(s, path, re, tries = 12) {
  const p = await s.cam("dash");
  s.take.cut();
  for (let i = 0; i < tries; i++) {
    await p.goto(`${s.cfg.dashboard}${path}`, { waitUntil: "domcontentloaded" });
    await dismissModals(p);
    for (let j = 0; j < 20; j++) {
      if (new RegExp(re).test(await p.locator("main").innerText().catch(() => ""))) { s.take.normal(); return p; }
      await sleep(1000);
    }
  }
  s.take.normal();
  throw new Error(`dashboard ${path}: /${re}/ never appeared`);
}
async function boxIn(s, cam, sel, re, label, kind = "ok") {
  // wait (off camera) for the target: dashboards render their lists after the page itself
  const p = s.take.pages[cam];
  const count = () => p.evaluate(([sl, r]) => [...document.querySelectorAll(sl)]
    .filter((e) => e.offsetParent && (!r || new RegExp(r, "i").test(e.innerText || e.value || ""))).length, [sel, re]);
  if (!(await count())) {
    s.take.cut();
    for (let i = 0; i < 45 && !(await count()); i++) await sleep(1000);
    s.take.normal();
  }
  const n = await s.take.box(cam, { sel, re }, label, kind);
  if (!n) throw new Error(`${cam}: nothing matches ${sel} ${re} (${label})`);
  await sleep(2500);
}

export const MODULES = {
  m1: { page: "03-module-01-your-cluster", title: "Module 1 · Your cluster", exercises: [
    { id: "m1-ex1", title: "Exercise 1 · Open the Web Terminal", intro: "Open the console's <b>Command line terminal</b>: a shell on the cluster, logged in as you.",
      run: async (s) => {
        const c = await s.cam("console");
        s.take.cut();
        await c.goto(s.cfg.console, { waitUntil: "domcontentloaded" });
        await sleep(9000);
        await dismissModals(c);  // a first login opens "Welcome to the new OpenShift experience!": Skip tour
        s.take.normal();
        const btn = c.locator('button[aria-label="Command line terminal"]').filter({ visible: true }).first();
        s.take.cut(); await btn.waitFor({ state: "visible", timeout: 60000 }); await sleep(1500); s.take.normal();
        await boxIn(s, "console", 'button[aria-label="Command line terminal"]', null, "Command line terminal", "info");
        await btn.click();
        await sleep(4000);
        const start = c.locator("form").filter({ hasText: "This Project will be used" }).getByRole("button", { name: "Start", exact: true });
        if (await start.isVisible().catch(() => false)) {
          await boxIn(s, "console", "form button", "^Start$", "keep openshift-terminal, click Start", "info");
          await start.click();
        }
        await s.waitFast(async () => /\$\s*$/m.test(await c.evaluate(() => window.__rec?.termText() || "")), "the terminal to start");
        await s.caption("The same terminal, full page", "For more room, the guide's videos use the full-page view of the same terminal: <code>/terminal</code> on the console.");
        await sleep(2500);
        await s.run(0, { expect: [T(`^${USER}$`, "your user"), T("^yes$", "cluster-admin")] });
      } },
    { id: "m1-ex2", title: "Exercise 2 · Find the GPU node", intro: "Find the GPU node by its <code>nvidia.com/gpu</code> taint.",
      run: (s) => s.run(1, { expect: [T("g6\\.2xlarge\\s+nvidia\\.com/gpu", "one L4 node, tainted")] }) },
    { id: "m1-ex3", title: "Exercise 3 · The GPU is not usable yet", intro: "Negative control: no hardware label, no GPU resource, no device classes, no driver.",
      run: (s) => s.run(2, { expect: [T("NVIDIA PCI label on \\S+: *$", "not recognised", "warn"), T('\\{"cpu":"7500m"', "no nvidia.com/gpu", "warn"), T("^none$", "nothing yet", "warn")] }) },
    { id: "m1-ex4", title: "Exercise 4 · Inventory", intro: "Operators are installed, nothing is configured.",
      run: (s) => s.run(3, { expect: [T("gpu-operator-certified\\.v\\S+ Succeeded", "GPU Operator"), T("rhcl-operator\\.v\\S+ Succeeded", "Connectivity Link"), T("^KserveReady$", "OpenShift AI ready")] }) },
  ] },

  m2: { page: "04-module-02-gpus-dra", title: "Module 2 · GPUs the DRA way", exercises: [
    { id: "m2-ex1", title: "Exercise 1 · Recognise the GPU", intro: "Node Feature Discovery labels nodes with the PCI vendors it finds; NVIDIA is <code>10de</code>.",
      run: (s) => s.run(0, { why: "NFD to label the node", expect: [T("g6\\.2xlarge", "pci-10de: the GPU node")] }) },
    { id: "m2-ex2", title: "Exercise 2 · Load the NVIDIA driver", intro: "An <code>NVIDIADriver</code> CR runs the driver container on the GPU node.",
      run: async (s) => { await s.run(1, { expect: [T("gpu-driver (created|configured|unchanged)", "NVIDIADriver")] });
        await s.run(2, { why: "the driver to build and load", expect: [T("driver state: ready", "driver loaded"), T("NVIDIA L4, 23034 MiB", "nvidia-smi sees the L4")] }); } },
    { id: "m2-ex3", title: "Exercise 3 · Turn on DRA", intro: "A <code>GPUCluster</code> CR runs the NVIDIA DRA driver: no device plugin.",
      run: (s) => s.run(3, { why: "the DRA stack", expect: [T("gpucluster state: ready", "DRA stack ready"), T("nvidia-dra-driver-kubelet-plugin\\S*\\s+1/1\\s+Running", "kubelet plugin")] }) },
    { id: "m2-ex4", title: "Exercise 4 · What DRA publishes", intro: "A DeviceClass selects devices; the ResourceSlice describes each one.",
      run: (s) => s.run(4, { expect: [T("^gpu\\.nvidia\\.com", "device class", "info"), T("gpu-0: NVIDIA L4, Ada Lovelace, memory 23034Mi", "the L4, described")] }) },
    { id: "m2-ex5", title: "Exercise 5 · Claim the GPU by property", intro: "A ResourceClaimTemplate with a CEL selector: one claim, one device, per pod.",
      run: (s) => s.run(5, { why: "smi-a to start", expect: [T("GPU 0: NVIDIA L4", "smi-a got the GPU"), T("smi-a-gpu-\\S+\\s+gpu-0\\s+smi-a", "allocated to gpu-0"), T("smi-b-gpu-\\S+\\s+<none>", "smi-b: no device", "warn")] }) },
    { id: "m2-ex6", title: "Exercise 6 · Two negative controls", intro: "An exclusive claim blocks a second pod; a selector that matches nothing blocks a pod even with the GPU free.",
      run: async (s) => { await s.run(6, { expect: [T("^Pending$", "smi-b waits", "warn"), T("cannot allocate all claims", "the scheduler's reason", "warn")] });
        await s.run(7, { why: "the H100 pod to be refused", expect: [T("^Pending$", "no H100 here", "warn"), T("cannot allocate all claims", "selector matches no device", "warn")] });
        await s.run(8, { expect: [T('smi-h100" deleted', "cleaned up", "info")] }); } },
    { id: "m2-ex7", title: "Exercise 7 · Share one GPU", intro: "Pods that name the same ResourceClaim share its device.",
      run: async (s) => { await s.run(9, { why: "both pods to start", expect: [T("GPU 0: NVIDIA L4 \\(UUID", "same UUID in both pods"), T("reserved for: share-a share-b", "one claim, two pods")] });
        await s.run(10, { expect: [T("reserved for: \\[\\] device: \\[\\]", "released", "info")] }); } },
  ] },

  m3: { page: "05-module-03-onboard-model", title: "Module 3 · Onboard a model", exercises: [
    { id: "m3-ex1", title: "Exercise 1 · Find the model in the catalog", intro: "Red Hat validated models, with the modelcar image to deploy.",
      run: async (s) => {
        const p = await dashboard(s, "/ai-hub/models/catalog");
        const f = p.getByPlaceholder(/Filter by name/);
        await boxIn(s, "dash", 'input[placeholder^="Filter by name"]', null, "Filter by name, description…", "info");
        await f.fill("granite-4.0-h-tiny"); await p.keyboard.press("Enter"); await sleep(3000);
        await s.take.clearBoxes();
        // the results render below the fold, only once scrolled into view
        const card = p.locator("a", { hasText: "granite-4.0-h-tiny-FP8-dynamic" }).first();
        for (let i = 0; i < 20 && !(await card.isVisible().catch(() => false)); i++) { await p.mouse.wheel(0, 400); await sleep(700); }
        await card.scrollIntoViewIfNeeded();
        await boxIn(s, "dash", "a", "^granite-4\\.0-h-tiny-FP8-dynamic$", "the validated FP8 model", "info");
        await card.click(); await sleep(7000);
        await boxIn(s, "dash", "main *", "^Validated$", "Validated");
        await boxIn(s, "dash", "main *", "^oci://registry\\.redhat\\.io/rhai/modelcar-granite", "Model location", "info");
        await s.run(0, { expect: [T("granite-4\\.0-h-tiny-FP8-dynamic\\s+6\\.9B", "same model, from the API"), T("modelcar-granite-4-0-h-tiny-fp8-dynamic:3\\.0", "the image KServe pulls", "info")] }); } },
    { id: "m3-ex2", title: "Exercise 2 · Create a model registry", intro: "Your registry: one <code>ModelRegistry</code> CR, REST API behind OpenShift auth.",
      run: (s) => s.run(1, { why: "the registry to start", expect: [T("field-registry condition met", "registry available"), T("field-registry-rest\\.", "its REST API", "info")] }) },
    { id: "m3-ex3", title: "Exercise 3 · Record model, version, artifact", intro: "Anonymous callers are refused; then record version 3.0 and its modelcar.",
      run: async (s) => { await s.run(2, { expect: [T("anonymous: 401", "no token, no entry", "warn")] });
        await s.run(3, { expect: [T("registered model id: \\d+, version id: \\d+", "recorded"), T('"modelFormatName": "vLLM"', "artifact: the modelcar", "info"), T("^3\\.0 LIVE$", "version 3.0")] });
        await dashboard(s, "/ai-hub/models/registry/field-registry");
        await boxIn(s, "dash", "main a, main td", "granite-4\\.0-h-tiny-fp8", "in the dashboard's Registry tab"); } },
    { id: "m3-ex4", title: "Exercise 4 · Prepare the serving project", intro: "A project, a GPU claim template, and a ServingRuntime you write yourself.",
      run: async (s) => { await s.run(4, { expect: [T("one-l4 (created|configured|unchanged)", "claim template")] });
        await s.run(5, { expect: [T("^yours:", "your runtime's image", "info"), T("^template:", "same image as the dashboard's", "info")],
          check: [{ re: "^yours:\\s+(\\S+)\\s*\\ntemplate:\\s+\\1\\s*$", why: "your runtime's image is not the dashboard template's" }] }); } },
    { id: "m3-ex5", title: "Exercise 5 · Serve on the claimed GPU", intro: "vLLM, behind authentication, on a GPU claimed through DRA.",
      run: async (s) => { await s.run(6, { expect: [T("granite4-tiny (created|configured|unchanged)", "InferenceService")] });
        await s.run(7, { why: "the modelcar to pull and vLLM to start", expect: [T("granite4-tiny condition met", "Ready"), T("-gpu-\\S+\\s+gpu-0", "its GPU claim")] }); } },
    { id: "m3-ex6", title: "Exercise 6 · Record the deployment", intro: "The registry learns where version 3.0 runs only when you record it.",
      run: async (s) => { await s.run(8, { expect: [T("granite4-tiny model=\\d+ version=\\d+ DEPLOYED", "recorded")] });
        await dashboard(s, "/ai-hub/models/registry/field-registry");
        await boxIn(s, "dash", "main td, main a, main button", "^1 deployment", "now: 1 deployment"); } },
    { id: "m3-ex7", title: "Exercise 7 · Who can call the model", intro: "401: who are you? 403: you may not. 200: you may.",
      run: async (s) => { await s.run(9, { expect: [T("anonymous:\\s+401", "no token", "warn"), T("SA without RBAC:\\s+403", "no RBAC", "warn"), T("you \\(cluster-admin\\): 200", "allowed")] });
        await s.run(10, { expect: [T('"finish": "tool_calls"', "the model asks for a tool"), T('^\\s+"name": "get_weather"', "which tool", "info")] }); } },
    { id: "m3-ex8", title: "Exercise 8 · What vLLM did with the GPU", intro: "Weights first; everything left becomes KV cache.",
      run: (s) => s.run(11, { expect: [T("Model loading took \\d[\\d.]* GiB", "weights", "info"), T("GPU KV cache size: \\d[\\d,]* tokens", "KV cache"), T("Maximum concurrency for \\d[\\d,]* tokens per request: \\d", "concurrent requests", "info")] }) },
  ] },

  m4: { page: "06-module-04-llm-d", title: "Module 4 · llm-d", exercises: [
    { id: "m4-ex1", title: "Exercise 1 · Free the GPU", intro: "Day 1's exclusive claim goes with its pod.",
      run: (s) => s.run(0, { why: "the claim to be released", expect: [T("No resources found|^shared-l4", "GPU free")] }) },
    { id: "m4-ex2", title: "Exercise 2 · Two replicas behind the scheduler", intro: "One LLMInferenceService: two replicas on one shared claim, plus llm-d's scheduler.",
      run: (s) => s.run(1, { expect: [T("RefsInvalid: Managed HTTPRoute references non-existent Gateway", "expected: no gateway yet", "warn")] }) },
    { id: "m4-ex3", title: "Exercise 3 · Create the inference gateway", intro: "Gateway API, the same pattern as OpenShift AI's own gateway.",
      run: (s) => s.run(2, { why: "two vLLM replicas to start", expect: [T("granite4-tiny condition met", "Ready"), T("kserve-router-scheduler\\S*\\s+1/1", "the scheduler (EPP)"), T("granite4-tiny-inference-pool", "InferencePool", "info")] }) },
    { id: "m4-ex4", title: "Exercise 4 · The scheduler's scorers", intro: "Prefix affinity weighs most; queue and KV-cache load can outvote it.",
      run: (s) => s.run(3, { expect: [T("pluginRef: prefix-cache-scorer", "prefix-cache, weight 3"), T("pluginRef: queue-scorer", "queue, weight 2", "info")] }) },
    { id: "m4-ex5", title: "Exercise 5 · An open door", intro: "Negative control: a policy object is not enforcement.",
      run: (s) => s.run(4, { expect: [T("anonymous: 200", "anyone can call it", "warn"), T("Enforced=False: kuadrant is not installed", "nothing enforces the policy", "warn")] }) },
    { id: "m4-ex6", title: "Exercise 6 · Routing by prefix", intro: "Two prompt families, five requests each: where did they go?",
      run: (s) => s.run(5, { why: "the requests", expect: [T("requests=5 prefix_cache_hits=\\d{3,}", "each family on one replica, cache hits")],
        check: [{ re: "^(alpha#[1-5] 200\\s*){5}$", why: "not five 200s for alpha" }, { re: "^(beta#[1-5] 200\\s*){5}$", why: "not five 200s for beta" },
          { fn: routedByPrefix, why: "each replica's requests did not grow by 5 with more prefix-cache hits" }] }) },
    { id: "m4-ex7", title: "Exercise 7 · Lose a replica", intro: "Break and restore: delete a replica under load.",
      run: (s) => s.run(6, { why: "the replacement replica", expect: [T("(200 ){9}200", "no failed request"), T("reserved for: granite4-tiny-kserve-", "two replicas share the claim again")] }) },
  ] },

  m5: { dbSecret: true, page: "07-module-05-maas-standup", title: "Module 5 · Stand up MaaS", exercises: [
    { id: "m5-ex1", title: "Exercise 1 · The MaaS database", intro: "PostgreSQL for API keys; the password never leaves the cluster.",
      run: (s) => s.run(0, { why: "PostgreSQL to start", expect: [T('"postgres" successfully rolled out', "database up")] }) },
    { id: "m5-ex2", title: "Exercise 2 · The Kuadrant instance", intro: "Authorino and Limitador start enforcing policies, and something breaks.",
      run: async (s) => { await s.run(1, { why: "Kuadrant", expect: [T("kuadrant condition met", "Kuadrant ready"), T("^authorino-\\S+\\s+1/1\\s+Running", "Authorino")] });
        await s.run(2, { why: "the policy to be enforced", expect: [T("openshift-ai-inference-authn condition met", "policy enforced", "info"), T("anonymous: 500", "expected: 500", "warn"), T("you: 500", "even with a token", "warn")] }); } },
    { id: "m5-ex3", title: "Exercise 3 · Diagnose and fix TLS", intro: "The gateway speaks TLS to Authorino; Authorino listens in plaintext.",
      run: async (s) => { await s.run(3, { expect: [T("^kuadrant_wasm_shim: gRPC status code is not OK", "gateway: auth call fails", "warn"), T("envoy\\.transport_sockets\\.tls", "gateway uses TLS", "info"), T('listener TLS: \\{"enabled":false\\}', "Authorino: plaintext", "warn")] });
        await s.run(4, { why: "Authorino to restart with TLS", expect: [T("anonymous: 401", "now enforced"), T("bad token: 401", "bad token refused"), T("you:\\s+200", "valid token allowed")] }); } },
    { id: "m5-ex4", title: "Exercise 4 · The MaaS gateway", intro: "A load-balanced Gateway; OpenShift publishes its DNS name.",
      run: (s) => s.run(5, { why: "the load balancer", expect: [T("maas-default-gateway condition met", "Programmed"), T("resolved: True$", "certificate resolved"), T("elb\\.amazonaws\\.com", "an AWS load balancer, with a DNS record", "info")] }) },
    { id: "m5-ex5", title: "Exercise 5 · Enable MaaS", intro: "One DataScienceCluster field brings up the MaaS controller and API.",
      run: async (s) => { await s.run(6, { why: "MaaS to start", retryUntil: "maas-api anonymous: 401", retries: 4,
          expect: [T('"maas-api" successfully rolled out', "maas-api"), T("maas-api anonymous: 401", "protected", "warn"), T('^\\{"data":\\[', "running: a model list (empty on a fresh cluster)")] });
        await s.run(7, { expect: [T("^true true$", "dashboard flags on")] }); } },
    { id: "m5-ex6", title: "Exercise 6 · Meter usage", intro: "User-workload monitoring and a TelemetryPolicy label usage by user and subscription.",
      run: async (s) => { await s.run(8, {});
        await s.run(9, { why: "user-workload monitoring", expect: [T("maas-telemetry condition met", "TelemetryPolicy enforced"), T("prometheus-user-workload-0", "Prometheus for user workloads", "info")] }); } },
  ] },

  m6: { dbSecret: true, page: "08-module-06-maas-govern", title: "Module 6 · Govern and consume MaaS", exercises: [
    { id: "m6-ex1", title: "Exercise 1 · Move the model to the MaaS gateway", intro: "Recreate the model on the MaaS gateway, reporting token usage.",
      run: (s) => s.run(0, { why: "two replicas to restart", expect: [T("granite4-tiny condition met", "Ready"), T("^https://maas\\.\\S+/ws-models/granite4-tiny", "its MaaS URL", "info")] }) },
    { id: "m6-ex2", title: "Exercise 2 · Two tiers", intro: "One model, two subscriptions with different token limits.",
      run: async (s) => { await s.run(1, { why: "governance to attach", expect: [T("^granite4-tiny\\s+Ready", "published"), T("GovernanceAttached=True", "governed", "info"), T("granite-bronze\\s+Active", "bronze tier", "info")] });
        await dashboard(s, "/maas/maas-governance");
        await boxIn(s, "dash", "main td, main a", "^granite-bronze$", "the tiers, in the dashboard");
        await boxIn(s, "dash", "main td, main a", "^granite-gold$", "", "ok"); } },
    { id: "m6-ex3", title: "Exercise 3 · Keys and calls", intro: "API keys per tier; no key, no answer.",
      run: (s) => s.run(2, { expect: [T("^gold key: sk-oai-", "keys minted (72 h)", "info"), T("publishers/ws-models/models/granite4-tiny", "what the key may use"), T("no key: 401", "no key", "warn")] }) },
    { id: "m6-ex4", title: "Exercise 4 · Tiers are real", intro: "The same burst on both keys.",
      run: (s) => s.run(3, { why: "24 requests", expect: [T("^bronze:\\s*(200 ){5}429", "bronze: limit reached", "warn"), T("^gold:\\s+(200 ){11}200", "gold: all served")] }) },
    { id: "m6-ex5", title: "Exercise 5 · Usage per subscription", intro: "Limitador's counters, labelled by the TelemetryPolicy.",
      run: async (s) => { await s.run(4, { expect: [T(`granite-gold ${USER}`, "tokens charged per tier"), T("^sum\\(limited_calls\\)", "429s counted", "info")] });
        const c = await s.cam("console");
        s.take.cut();
        await c.goto(`${s.cfg.console}/monitoring/query-browser`, { waitUntil: "domcontentloaded" }); await sleep(9000);
        s.take.normal();
        await c.locator(".cm-content").first().click(); await c.keyboard.type("sum by (subscription) (authorized_hits)");
        await c.getByRole("button", { name: /Run queries/i }).click(); await sleep(6000);
        await boxIn(s, "console", "main td", "^granite-gold$", "Observe › Metrics"); } },
    { id: "m6-ex6", title: "Exercise 6 · An application", intro: "A URL, a key and a CA: nothing else.",
      run: (s) => s.run(5, { why: "the application job", expect: [T("maas-client condition met", "job done"), T("^ANSWER:", "the model's answer"), T("^USAGE:", "tokens used", "info")] }) },
  ] },

  m7: { dbSecret: true, page: "09-module-07-mlflow-tracing", title: "Module 7 · Trace an agent with MLflow", exercises: [
    { id: "m7-ex1", title: "Exercise 1 · Enable MLflow", intro: "One DSC field and an MLflow CR.",
      run: (s) => s.run(0, { why: "MLflow to start", expect: [T("mlflow condition met", "tracking server up"), T("version 3\\.14\\.0", "MLflow 3.14", "info")] }) },
    { id: "m7-ex2", title: "Exercise 2 · Workspaces and RBAC", intro: "A workspace is a project; Kubernetes RBAC decides.",
      run: (s) => s.run(1, { expect: [T("no token:\\s+302", "login required", "warn"), T("Workspace context is required", "which workspace?", "warn"), T("^\\{\\}$", "ws-agent: empty")] }) },
    { id: "m7-ex3", title: "Exercise 3 · No rights, no traces", intro: "Negative control: the agent may call MaaS but not write to MLflow.",
      run: async (s) => { await s.run(2, { expect: [T("gold key: 200", "gold key works")] });
        await s.run(3, { expect: [T("configmap/weather-agent (created|configured|unchanged)", "the agent's code", "info")] });
        await s.run(4, { why: "the agent job", expect: [T("^PERMISSION_DENIED$|'PERMISSION_DENIED'", "MLflow refuses", "warn"), T("^job: failed", "as expected", "warn")] }); } },
    { id: "m7-ex4", title: "Exercise 4 · Grant tracing rights", intro: "The integration role, in this project only.",
      run: (s) => s.run(5, { why: "the agent job", expect: [T("^TRACE tr-\\S+ OK", "trace recorded"), T("SPAN TOOL\\s+get_weather", "the tool call"), T("^job: succeeded", "done")] }) },
    { id: "m7-ex5", title: "Exercise 5 · Read the trace", intro: "From the API, then in the dashboard, down to the tool span.",
      run: async (s) => {
        await s.run(6, { expect: [T("tr-\\S+\\s+OK\\s+\\d+ ms\\s+agent", "stored in MLflow")] });
        const p = await dashboard(s, "/develop-train/mlflow/experiments?workspace=ws-agent");
        await boxIn(s, "dash", "main a, main td, main span", "^weather-agent$", "project ws-agent");
        await p.locator("main").getByText("weather-agent", { exact: true }).first().click(); await sleep(8000);
        await p.getByText("Traces", { exact: true }).first().click(); await sleep(8000);
        await boxIn(s, "dash", "main a, main td, main span, main div", "^tr-[0-9a-f]{12,}$", "newest trace", "info");
        await p.locator("main").getByText(/^tr-[0-9a-f]{12,}$/).first().click(); await sleep(6000);
        await boxIn(s, "dash", "*", "Completions\\s+was called", "model call", "info");
        await boxIn(s, "dash", "*", "get_weather\\s+was called", "tool call");
        await p.getByText("Details & Timeline", { exact: true }).first().click(); await sleep(3000);
        await p.getByText("get_weather", { exact: true }).first().click(); await sleep(3000);
        await boxIn(s, "dash", "input, textarea, div", "^Seoul$", "tool input: city"); } },
  ] },

  m8: { dbSecret: true, page: "10-module-08-evalhub", title: "Module 8 · Evaluate with EvalHub", exercises: [
    { id: "m8-ex1", title: "Exercise 1 · Deploy EvalHub", intro: "One CR; evaluations go to its REST API.",
      run: async (s) => { await s.run(0, { why: "EvalHub to start", expect: [T("phase Ready, providers", "EvalHub ready"), T("^MLflow: https://mlflow\\.", "results go to MLflow", "info"), T("evalhub-ws-eval-job", "the jobs' identity", "info"), T("odh-dashboard-config patched", "Evaluations page on", "info")] });
        // empty on a first run; a re-run of the module lists the runs already made
        await dashUntil(s, "/evaluation/ws-eval", "No evaluation runs|Start evaluation run");
        await boxIn(s, "dash", "nav a", "^Evaluations", "Develop & train → Evaluations", "info");
        await boxIn(s, "dash", "main button", "^Start evaluation run$", "the page is a client of your EvalHub"); } },
    { id: "m8-ex2", title: "Exercise 2 · What can it run?", intro: "Providers and benchmarks, from the API.",
      run: async (s) => { await s.run(1, { expect: [T("jobs\\s+\\(no token\\): 401", "API protected", "warn"), T("lm_evaluation_harness: \\d+ benchmarks", "LM Evaluation Harness"), T('"id": "arc_easy"', "our benchmark", "info")] });
        const p = await dashUntil(s, "/evaluation/ws-eval", "Start evaluation run");
        await p.getByRole("button", { name: "Start evaluation run" }).first().click(); await sleep(3000);
        await p.getByText("Benchmark", { exact: true }).first().click();
        await boxIn(s, "dash", "main *", "^Basic science Q&A$", "arc_easy: the same catalog");
        await p.getByRole("link", { name: "Evaluations" }).first().click(); await sleep(1500); } },
    { id: "m8-ex3", title: "Exercise 3 · Evaluate the MaaS model", intro: "arc_easy, 50 questions, through a MaaS key held in a Secret.",
      run: async (s) => { await s.run(2, { expect: [T("secret/maas-model (created|configured|unchanged)", "key and CA in a Secret", "info")] });
        await s.run(3, { why: "the evaluation", expect: [T('"state": "completed"', "completed"), T('"acc": 0\\.\\d+', "accuracy (±0.07 on 50 questions)"), T('"pass": true', "above the gate you set", "info"), T('"mlflow_experiment": "\\d+"', "recorded in MLflow", "info")] });
        const p = await dashUntil(s, "/evaluation/ws-eval", "granite-arc-easy");
        await boxIn(s, "dash", "main td", "^Complete$", "the API job, listed", "info");
        await p.locator("main a").filter({ hasText: /^granite-arc-easy$/ }).first().click();
        await boxIn(s, "dash", "main *", "^56%$|^\\d\\d%$", "evaluation score");
        await boxIn(s, "dash", "main *", "^Pass$", "verdict", "info");
        await boxIn(s, "dash", "main a", "^acc_stderr$", "the MLflow run's metrics", "info");
        await boxIn(s, "dash", "main *", "^Experiment ID$", "MLflow experiment and run", "info"); } },
    { id: "m8-ex4", title: "Exercise 4 · A wrong key", intro: "Negative control: the evaluation must fail loudly.",
      run: (s) => s.run(4, { why: "the evaluation", expect: [T('"state": "failed"', "failed, no score", "warn"), T("HTTP 403", "MaaS refused the key", "warn")] }) },
    { id: "m8-ex5", title: "Exercise 5 · A MaaS consumer too", intro: "The evaluation's tokens were charged to the gold tier.",
      run: (s) => s.run(5, { why: "Prometheus to scrape", expect: [T("charged by the evaluation: [1-9]\\d*", "tokens charged")] }) },
    { id: "m8-ex6", title: "Exercise 6 · From the dashboard", intro: "The wizard builds the same job; both runs land in MLflow.",
      run: async (s) => { await s.run(6, { expect: [T("^Endpoint URL: https://maas\\.", "the endpoint to paste", "info")] });
        const url = ((await s.take.pages.term.evaluate(() => window.__rec?.termText() || "")).match(/^Endpoint URL: (\S+)/m) || [])[1];
        if (!url) throw new Error("no endpoint URL on screen");
        const p = await dashUntil(s, "/evaluation/ws-eval", "Start evaluation run");
        await p.getByRole("button", { name: "Start evaluation run" }).first().click(); await sleep(3000);
        await p.getByText("Benchmark", { exact: true }).first().click();
        await boxIn(s, "dash", "main *", "^Basic science Q&A$", "arc_easy", "info");
        await p.getByRole("button", { name: "Select benchmark" }).first().click();
        await boxIn(s, "dash", "main label", "^Evaluation name", "the same job, as a form", "info");
        await p.locator("#evaluation-name").fill("granite-arc-easy-gui");
        await p.getByTestId("mlflow-experiment-selector-toggle").click(); await sleep(1500);
        await p.getByRole("row").filter({ hasText: "granite-evals" }).first().click(); await sleep(800);
        await p.getByRole("button", { name: /Choose model/ }).first().click(); await sleep(800);
        await p.getByText("Other (External endpoint)").click(); await sleep(800);
        await p.getByRole("textbox", { name: "Model name" }).first().fill("granite4-tiny");
        await p.getByRole("textbox", { name: "Endpoint URL" }).first().fill(url);
        await p.getByRole("textbox", { name: "API key secret name" }).first().fill("maas-model");
        await p.getByRole("button", { name: "Validate connection" }).click();
        await boxIn(s, "dash", "main .pf-v6-c-helper-text__item-text", "^Connection established successfully", "through MaaS, with the Secret's key and CA");
        await p.getByRole("spinbutton", { name: "Benchmark threshold" }).fill("50");
        await p.locator("#show-additional-args").check(); await sleep(800);
        await p.locator("main textarea").fill('{"num_examples": 50, "num_few_shot": 0, "tokenizer": "ibm-granite/granite-4.0-h-tiny"}');
        await boxIn(s, "dash", "main textarea", null, "the same parameters as the API job", "info");
        await p.getByTestId("start-evaluation-submit").click({ timeout: 15000 });
        await boxIn(s, "dash", "main td", "^Pending$|^Running$", "started", "info");
        await s.run(7, { why: "the evaluation", expect: [T('"state": "completed"', "completed"), T('"threshold": 0\\.5(?!\\d)', "the 50 you set", "info"), T('"pass": true', "pass"), T("^granite-arc-easy-gui\\s+completed\\s+acc=0\\.\\d+", "dashboard run", "info"), T("^granite-arc-easy\\s+completed\\s+acc=0\\.\\d+", "API run, same score")],
          check: [{ why: "both runs in the same MLflow experiment", fn: (t) => { const id = (n) => (t.match(new RegExp(`^${n}\\s.*mlflow_experiment=(\\S+)`, "m")) || [])[1];
            const a = id("granite-arc-easy-gui"), b = id("granite-arc-easy"); return !!a && a !== "-" && a === b; } }] });
        const q = await dashUntil(s, "/evaluation/ws-eval", "granite-arc-easy-gui");
        const rows = q.locator("main tbody tr");
        for (const name of ["granite-arc-easy-gui", "granite-arc-easy"]) await rows.filter({ has: q.locator("a", { hasText: new RegExp(`^${name}$`) }) }).locator("input[type=checkbox]").check();
        await q.getByRole("button", { name: "Compare" }).click();
        await boxIn(s, "dash", "main *", "^Comparing granite-arc-easy-gui and granite-arc-easy$", "MLflow's run comparison"); } },
  ] },

  m9: { dbSecret: true, page: "11-module-09-guardrails", title: "Module 9 · Guard it with NeMo Guardrails", exercises: [
    { id: "m9-ex1", title: "Exercise 1 · A guarded endpoint", intro: "Authentication at creation, then a fast pattern rail.",
      run: async (s) => { await s.run(0, { why: "the guardrails server", expect: [T("no token: 401", "no token", "warn"), T("token, no rights: 403", "no rights", "warn"), T('\\[\\{"id":"regex-only"\\}\\]', "you: allowed")] });
        await s.run(1, { expect: [T("^blocked\\s+regex check input.*pipe bomb", "pattern match"), T("^success.*pick a lock", "meaning missed", "warn")] }); } },
    { id: "m9-ex2", title: "Exercise 2 · An LLM as the judge", intro: "A written policy, judged by your Granite model.",
      run: (s) => s.run(2, { why: "the judge's verdicts", expect: [T("^blocked\\s+self check input.*pick a lock", "meaning understood"), T("^success.*Python process", "trap allowed")] }) },
    { id: "m9-ex3", title: "Exercise 3 · Measure both rails", intro: "Twelve labelled prompts: precision and recall.",
      run: (s) => s.run(3, { why: "24 verdicts", expect: [T("^regex-only: TP=2", "pattern rail", "warn"), T("^self-check: TP=6 FP=0 FN=0 TN=6", "judge")] }) },
    { id: "m9-ex4", title: "Exercise 4 · The judge goes away", intro: "Break and restore: a guardrail has three outcomes.",
      run: (s) => s.run(4, { why: "two configuration rollouts", expect: [T("^error\\s", "neither blocked nor allowed", "warn"), T("^blocked\\s+self check input", "restored")] }) },
    { id: "m9-ex5", title: "Exercise 5 · An open path", intro: "Negative control: any pod can reach the model without MaaS.",
      run: (s) => s.run(5, { why: "the probe pod", expect: [T("from ws-gpu-lab: 200", "MaaS bypassed", "warn")] }) },
    { id: "m9-ex6", title: "Exercise 6 · Close it", intro: "A NetworkPolicy on the model pods.",
      run: (s) => s.run(6, { why: "two probe pods", expect: [T("from ws-gpu-lab: 000", "blocked"), T("from ws-guard: 200", "guardrails still allowed", "info"), T("MaaS with the gold key: 200", "front door works")] }) },
  ] },
  // Run last by `all`: the participant cleanup, checked like every other step but published as no video.
  cleanup: { page: "90-cleanup", title: "Cleanup", video: false, exercises: [
    { id: "cleanup-look", title: "What will go", intro: "Everything the labs created.",
      run: (s) => s.run(0, { expect: [T("gpu-driver\\s+ready", "the Day 1 GPU stack", "info")], check: [NO_OC_ERROR] }) },
    { id: "cleanup-day3", title: "Day 3", intro: "Projects, the NetworkPolicy and MLflow.",
      run: async (s) => { await s.run(1, { expect: [T("^mlflow\\s+True", "the tracking server", "info")], check: [NO_OC_ERROR] });
        await s.run(2, { why: "the projects to go", expect: [T('project.project.openshift.io "ws-guard" deleted', "Day 3 projects gone"), T("default-dsc patched", "MLflow set to Removed")], check: [NO_OC_ERROR] }); } },
    { id: "cleanup-day2", title: "Day 2", intro: "Keys, then the service, then the platform.",
      run: async (s) => { await s.run(3, { expect: [T("^aigateway: Managed", "MaaS still enabled", "info")], check: [NO_OC_ERROR] });
        await s.run(4, { why: "MaaS to go", expect: [T('aitenant.maas.opendatahub.io "models-as-a-service" deleted', "tenant removed while its controller runs"), T('namespace "redhat-ai-gateway-infra" deleted', "MaaS namespaces gone"), T("^data-science-gateway\\s+data-science-gateway-class", "only OpenShift AI's own gateway left")], check: [NO_OC_ERROR] }); } },
    { id: "cleanup-day1", title: "Day 1", intro: "Model server and registry, then the GPU stack.",
      run: (s) => s.run(5, { why: "the GPU stack to go", expect: [T("^no NVIDIA device classes", "DRA stack and driver gone")], check: [NO_OC_ERROR] }) },
  ] },
};
