// Offline checks of the recorder's step definitions and safety rules (no cluster needed):
//   node test.mjs
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { executeBlocks, failedChecks, inspect, loadSecrets, publish, rel, scan, scanSecretRefs, selectRun } from "./lib.mjs";
import { MODULES } from "./steps.mjs";

// Evaluate an exercise's `expect` regexes against given terminal text, per execute block.
async function check(ex, blockText) {
  const missing = [];
  const run = async (i, opts = {}) => {
    for (const e of opts.expect || []) if (!new RegExp(e.re, "m").test(blockText(i))) missing.push(`block ${i + 1}: /${e.re}/`);
    for (const why of failedChecks(opts.check, blockText(i))) missing.push(`block ${i + 1}: ${why}`);
  };
  // GUI parts cannot run here; the terminal blocks before them are checked
  await ex.run(new Proxy({ run }, { get: (t, k) => (k in t ? t[k] : () => { throw new Error("GUI step"); }) }))
    .catch((e) => { if (e.message !== "GUI step") throw e; });
  return missing;
}
const ex = (m, id) => MODULES[m].exercises.find((e) => e.id === id);

// 1. The cleanup steps match the cleanup page's real output (walk of the test cluster, 2026-11-03).
const walk = fs.readFileSync(rel("fixtures/cleanup-walk.txt"), "utf8").split(/^===== block \d+ .*=====$/m).slice(1);
assert.equal(walk.length, 6);
assert.ok(Object.keys(MODULES).at(-1) === "cleanup" && MODULES.cleanup.video === false, "cleanup runs last, without video");
for (const e of MODULES.cleanup.exercises) assert.deepEqual(await check(e, (i) => walk[i]), [], e.id);

// 2. Module 8 Exercise 3 passes only on the guide's result: completed, scored, and above the gate.
const evalOut = (pass) => `secret/maas-model configured\n"state": "completed",\n  "acc": ${pass ? "0.56" : "0.01"},\n  "pass": ${pass},\n  "mlflow_experiment": "2"`;
assert.deepEqual(await check(ex("m8", "m8-ex3"), () => evalOut(true)), []);
assert.notDeepEqual(await check(ex("m8", "m8-ex3"), () => evalOut(false)), [], "a failed gate must not match the guide");

// 3. The participant's username comes from LAB_USER, not a hardcoded account.
const src = fs.readFileSync(rel("steps.mjs"), "utf8");
assert.deepEqual(src.split("\n").filter((l) => l.includes("kuro") && !l.includes('process.env.LAB_USER || "kuro"')), []);
const m6ex5 = (user) => execFileSync("node", ["--input-type=module", "-e", `
  import { MODULES } from "./steps.mjs";
  const ex = MODULES.m6.exercises.find((e) => e.id === "m6-ex5");
  await ex.run({ run: async (i, o) => { console.log(o.expect[0].re); throw new Error("stop"); } }).catch(() => {});`],
  { cwd: rel("."), env: { ...process.env, LAB_USER: user }, encoding: "utf8" }).trim();
assert.ok(new RegExp(m6ex5("participant1")).test("granite-gold participant1"));
assert.ok(!new RegExp(m6ex5("participant1")).test("granite-gold kuro"));
assert.ok(new RegExp(m6ex5("a.b")).test("granite-gold a.b") && !new RegExp(m6ex5("a.b")).test("granite-gold axb"), "LAB_USER is escaped");

// 4. From Module 5 on, an unreadable database password stops the recording instead of going unscanned.
const pw = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rec-test-")), "pw");
fs.writeFileSync(pw, "not-a-real-password", { mode: 0o600 });
assert.deepEqual(Object.entries(MODULES).filter(([, d]) => d.dbSecret).map(([m]) => m), ["m5", "m6", "m7", "m8", "m9"]);
assert.throws(() => loadSecrets({ passwordFile: pw, secretRefs: scanSecretRefs(MODULES.m6) }, () => ""), /cannot load Secret/);
assert.doesNotThrow(() => loadSecrets({ passwordFile: pw, secretRefs: scanSecretRefs(MODULES.m1) }, () => ""));

// 5. Re-recording removes the old video first, so a failed take leaves no stale video behind.
const tmp = path.dirname(pw), out = path.join(tmp, "out"), state = path.join(tmp, "state.json");
fs.mkdirSync(out); fs.writeFileSync(path.join(out, "m1-ex1.mp4"), "old"); fs.writeFileSync(path.join(out, "m1-ex2.mp4"), "old");
fs.writeFileSync(state, '{"cookies":[],"origins":[]}');
const r = spawnSync("node", ["record.mjs", "m1", "--to", "m1-ex1"], { cwd: rel("."), encoding: "utf8", timeout: 120000,
  env: { ...process.env, DOMAIN: "cluster.invalid", STATE: state, OUT: out, LAB_PASSWORD_FILE: pw, KUBEADMIN_PASSWORD_FILE: "" } });
assert.notEqual(r.status, 0, "recording against an unreachable cluster must fail");
assert.ok(!fs.existsSync(path.join(out, "m1-ex1.mp4")), "the failed exercise's old video was kept");
assert.ok(fs.existsSync(path.join(out, "m1-ex2.mp4")), "an exercise outside --to was deleted");

// 6. Expectations that are easy to satisfy by the wrong output.
const img = "registry.redhat.io/rhaiis/vllm-cuda-rhel9@sha256:abc";
assert.deepEqual(await check(ex("m3", "m3-ex4"), (i) => i === 4 ? "one-l4 created" : `yours:    ${img}\ntemplate: ${img}`), []);
assert.notDeepEqual(await check(ex("m3", "m3-ex4"), (i) => i === 4 ? "one-l4 created" : `yours:    ${img}\ntemplate: ${img}x`), [], "unequal images accepted");
assert.deepEqual(await check(ex("m3", "m3-ex8"), () => "GPU KV cache size: 1,310,720 tokens\nMaximum concurrency for 16,384 tokens per request: 80.00x\nModel loading took 6.64 GiB"), []);
assert.notDeepEqual(await check(ex("m8", "m8-ex5"), () => "charged by the evaluation: 0"), [], "zero tokens accepted");
// m7-ex3's refusal as the agent printed it on the test cluster (2026-11-04)
const denied = "job.batch/weather-agent created\nERROR: Response: {'error': {'code': 'PERMISSION_DENIED', 'message': 'Permission denied for requested operation.'}}\njob: failed";
assert.deepEqual((await check(ex("m7", "m7-ex3"), (i) => (i === 4 ? denied : "gold key: 200\nserviceaccount/weather-agent created"))).filter((m) => m.startsWith("block 5")), []);
assert.deepEqual(await check(ex("m8", "m8-ex5"), () => "charged by the evaluation: 6314"), []);

// 7. No expectation may be satisfied by the pasted command itself (the terminal shows it too).
const www = rel("..", "..", "www/modules"), echoed = [];
for (const [m, mod] of Object.entries(MODULES)) {
  const blocks = executeBlocks(www, mod.page);
  for (const e of mod.exercises) {
    const run = async (i, opts = {}) => { for (const x of opts.expect || []) if (new RegExp(x.re, "m").test(blocks[i])) echoed.push(`${e.id} block ${i + 1}: /${x.re}/`); };
    const stub = new Proxy({ run }, { get: (t, k) => (k in t ? t[k] : () => { throw new Error("GUI step"); }) });
    await e.run(stub).catch(() => {});  // GUI parts cannot run here; the blocks before them are checked
  }
}
assert.deepEqual(echoed, []);

// 7b. The Web Terminal drops a paste of about 3,070 characters or more (measured on the test cluster:
// 3,050 arrives, 3,072 does not), for a participant as for the recorder: every block stays below 3,000.
const long = [];
for (const f of fs.readdirSync(www).filter((x) => x.endsWith(".html"))) {
  let blocks = []; try { blocks = executeBlocks(www, f.replace(/\.html$/, "")); } catch { /* no blocks */ }
  blocks.forEach((b, i) => { if (b.length >= 3000) long.push(`${f} block ${i + 1}: ${b.length}`); });
}
assert.deepEqual(long, []);

// 8. Module 7's negative control survives a re-run after Exercise 4 (the guide's restart advice).
const m7 = executeBlocks(www, MODULES.m7.page).find((b) => b.includes("\nrun_agent") && !b.includes("oc create rolebinding"));
assert.ok(m7 && /oc delete rolebinding weather-agent-mlflow[^\n]*\nrun_agent\s*$/.test(m7), "Exercise 3 must drop Exercise 4's RoleBinding before running the agent");

// 9. The secret scan: known secrets (also wrapped across rows), token shapes, and unread captures.
const pwText = "s3cr3t-Passw0rd-xyz";
assert.ok(scan([`echo ${pwText}`], [pwText]).includes("known secret"));
assert.ok(scan(["s3cr3t-Pass\nw0rd-xyz"], [pwText]).includes("known secret"), "a wrapped secret was missed");
assert.ok(scan(["key sk-oai-ABCDEFGHIJKLMNOPQRSTUV"], []).length && scan(["sha256~ABCDEFGHIJKLMNOPQRSTUVWXYZ"], []).length);
assert.ok(scan(["eyJhbGciOiJSUzI1NiIsImtpZCI6Ij\nAbCdEfGhIjKlMnOpQrStUv.eyJpc3MiOiJrdWJlcm5ldGVz"], []).length, "a wrapped token was missed");
assert.deepEqual(scan(["oc get pods -n ws-models", "sk-oai-ABC… (first ten characters)"], [pwText]), []);
const fake = (texts, unread = 0) => ({ marks: [{ name: "x", t: 1 }], textsBy: { x: new Set(texts) }, unreadBy: { x: unread } });
assert.deepEqual(inspect(fake(["clean"]), [pwText], "x"), []);
assert.ok(inspect(fake([]), [pwText], "x").includes("no text was inspected"));
assert.ok(inspect(fake(["clean"], 1), [pwText], "x").some((h) => /could not read/.test(h)));

// 10. publish(): a scan hit or an encode failure leaves no video and reports failure, which stops the run
// before any later module (and the destructive cleanup).
const pub = path.join(tmp, "pub"); fs.mkdirSync(pub);
const quiet = { log() {}, error() {} };
let encoded = 0;
const enc = (from, to, file) => { encoded++; fs.writeFileSync(file, "mp4"); return { seconds: 1, factor: 1 }; };
fs.writeFileSync(path.join(pub, "x.mp4"), "old");
assert.equal(publish({ take: fake([`password ${pwText}`]), done: [{ id: "x", t: 1 }], end: 2, out: pub, secrets: [pwText], enc, log: quiet }), false);
assert.ok(!encoded && !fs.existsSync(path.join(pub, "x.mp4")), "a video failing the scan was encoded or kept");
assert.equal(publish({ take: fake(["clean"]), done: [{ id: "x", t: 1 }], end: 2, out: pub, secrets: [pwText], enc: () => { throw new Error("ffmpeg"); }, log: quiet }), false);
assert.ok(!fs.existsSync(path.join(pub, "x.mp4")));
assert.equal(publish({ take: fake(["clean"]), done: [{ id: "x", t: 1 }], end: 2, out: pub, secrets: [pwText], enc, log: quiet }), true);
assert.ok(encoded === 1 && fs.existsSync(path.join(pub, "x.mp4")));
const recSrc = fs.readFileSync(rel("record.mjs"), "utf8");
assert.match(recSrc, /return published;/, "recordModule must report a publishing failure to the module loop");


// 11. --from/--to select exercises across modules: nothing after --to runs (least of all the cleanup).
const ids = (todo, from, to) => selectRun(MODULES, todo, from, to).flatMap((x) => x.exercises.map((e) => e.id));
assert.deepEqual(ids(Object.keys(MODULES), null, "m1-ex1"), ["m1-ex1"]);
assert.deepEqual(ids(["m1", "m2"], null, "m1-ex1"), ["m1-ex1"]);
assert.deepEqual(ids(["m5"], "m5-ex4", null), MODULES.m5.exercises.slice(3).map((e) => e.id));
assert.deepEqual(ids(Object.keys(MODULES), "m9-ex6", "m9-ex6"), ["m9-ex6"]);
assert.throws(() => ids(["m1"], "m2-ex1", null), /not among/);
assert.throws(() => ids(["m1"], "m1-ex2", "m1-ex1"), /comes after/);

// 12. Module 4 Exercise 6: ten 200s, and on both replicas +5 requests with more cache hits.
const counters = (r1, h1, r2, h2) => `granite4-tiny-kserve-a requests=${r1} prefix_cache_hits=${h1}\ngranite4-tiny-kserve-b requests=${r2} prefix_cache_hits=${h2}`;
const fam = (f, code) => [1, 2, 3, 4, 5].map((i) => `${f}#${i} ${code}`).join("  ");  // as xterm shows it: trailing spaces trimmed
const routing = (code, after) => `BEFORE\n${counters(0, 0, 0, 0)}\n${fam("alpha", code)}\n${fam("beta", code)}\nAFTER\n${after}\nbash-5.1 ~ $`;
assert.deepEqual(await check(ex("m4", "m4-ex6"), () => routing(200, counters(5, 4096, 5, 4112))), []);
const real = `echo "BEFORE"; counters\nBEFORE\ngranite4-tiny-kserve-5f7688d9df-5wqvt requests=0 prefix_cache_hits=0\ngranite4-tiny-kserve-5f7688d9df-xgznt requests=0 prefix_cache_hits=0
alpha#1 200  alpha#2 200  alpha#3 200  alpha#4 200  alpha#5 200\nbeta#1 200  beta#2 200  beta#3 200  beta#4 200  beta#5 200\nAFTER
granite4-tiny-kserve-5f7688d9df-5wqvt requests=5 prefix_cache_hits=4096\ngranite4-tiny-kserve-5f7688d9df-xgznt requests=5 prefix_cache_hits=4096\nbash-5.1 ~ $`;
assert.deepEqual(await check(ex("m4", "m4-ex6"), () => real), [], "the recorded m4-ex6 output (video frame, 2026-11-03)");
assert.notDeepEqual(await check(ex("m4", "m4-ex6"), () => routing(500, counters(5, 4096, 5, 4112))), [], "failed requests accepted");
assert.notDeepEqual(await check(ex("m4", "m4-ex6"), () => routing(200, counters(10, 8192, 0, 0))), [], "one replica took everything");
assert.notDeepEqual(await check(ex("m4", "m4-ex6"), () => routing(200, counters(3, 2048, 7, 6144))), [], "families split across replicas accepted");
assert.notDeepEqual(await check(ex("m4", "m4-ex6"), () => routing(200, counters(5, 4096, 7, 6144))), [], "a replica that served 7 of 10 accepted");
assert.notDeepEqual(await check(ex("m4", "m4-ex6"), () => routing(200, counters(5, 4096, 5, 4112)).replace("alpha#3 200", "alpha#3 500")), [], "one failed alpha request accepted");
assert.notDeepEqual(await check(ex("m4", "m4-ex6"), () => `BEFORE\n${counters(5, 4096, 5, 4096)}\n${fam("alpha", 200)}\n${fam("beta", 200)}\nAFTER\n${counters(5, 4096, 5, 4096)}`), [], "unchanged counters accepted");

// 13. A cleanup step with a failed delete does not pass.
const day1 = walk[5].replace('project.project.openshift.io "ws-gpu-lab" deleted', 'Error from server (Forbidden): projects "ws-gpu-lab" is forbidden');
assert.notDeepEqual(await check(ex("cleanup", "cleanup-day1"), (i) => (i === 5 ? day1 : walk[i])), [], "a failed delete passed");

// 14. Module 9's negative control survives a re-run after Exercise 6.
const m9 = executeBlocks(www, MODULES.m9.page).find((b) => /\nprobe ws-gpu-lab\s*$/.test(b));
assert.ok(m9 && /oc delete networkpolicy granite4-tiny-ingress[^\n]*\nprobe ws-gpu-lab\s*$/.test(m9), "Exercise 5 must drop Exercise 6's NetworkPolicy before probing");

// 10. Module 8 Exercise 1 passes on a first run (no evaluations) and on a re-run (runs listed).
async function m8ex1(mainText, buttons) {
  const page = { goto: async () => {}, keyboard: { press: async () => {} },
    locator: (sel) => ({ innerText: async () => mainText, filter: () => ({ first: () => ({ count: async () => 0 }) }), first: () => ({ count: async () => 0 }) }),
    evaluate: async (_f, [sel, re]) => (sel === "main button" ? buttons : ["Evaluations"]).filter((t) => !re || new RegExp(re, "i").test(t)).length };
  const take = { cut() {}, normal() {}, pages: { dash: page }, box: async (_c, { sel, re }) => page.evaluate(null, [sel, re]) };
  const s = { cfg: { dashboard: "https://dash.invalid" }, take, cam: async () => page, run: async () => {} };
  await MODULES.m8.exercises.find((e) => e.id === "m8-ex1").run(s);
}
await m8ex1("No evaluation runs\nStart evaluation run", ["Start evaluation run"]);
await m8ex1("Evaluation runs\narc_easy  Completed\nStart evaluation run", ["Start evaluation run"]);

// 11. Module 8 Exercise 6's result checks (block 7, after the dashboard wizard) accept a completed,
// passing run at the 50% threshold and reject a failed one, a wrong threshold or a fail verdict.
const any = new Proxy(function () {}, { get: (_t, k) => (k === "then" ? undefined : k === Symbol.toPrimitive ? () => "Start evaluation run granite-arc-easy-gui" : any), apply: () => any });
const m8ex6 = async (out) => {
  const missing = [];
  const run = async (i, opts = {}) => { if (i === 7) for (const e of opts.expect || []) if (!new RegExp(e.re, "m").test(out)) missing.push(e.label); };
  const s = { cfg: { dashboard: "" }, run, cam: async () => any,
    take: { cut() {}, normal() {}, box: async () => 1, pages: { dash: any, term: { evaluate: async () => "Endpoint URL: https://maas.example/v1" } } } };
  await MODULES.m8.exercises.find((e) => e.id === "m8-ex6").run(s);
  return missing;
};
const good = '"state": "completed"\n"threshold": 0.5\n"pass": true\ngranite-arc-easy-gui  completed  acc=0.62\ngranite-arc-easy  completed  acc=0.62';
assert.deepEqual(await m8ex6(good), [], "a completed, passing run at 0.5 was refused");
assert.notDeepEqual(await m8ex6(good.replace('"state": "completed"', '"state": "failed"')), [], "a failed evaluation accepted");
assert.notDeepEqual(await m8ex6(good.replace('"threshold": 0.5', '"threshold": 0.6')), [], "a wrong threshold accepted");
assert.notDeepEqual(await m8ex6(good.replace('"pass": true', '"pass": false')), [], "a fail verdict accepted");

fs.rmSync(tmp, { recursive: true, force: true });
console.log("recorder test: PASS");
