// Records the workshop's step videos as the participant, from the built guide (run `npm run build`
// first), module by module in guide order. Recording runs the lab for real: it is the end-to-end walk.
// Usage: node record.mjs list | all | m1 [m2 ...] [--from m3-ex5] [--to m3-ex6]
// Env: DOMAIN, STATE (session from login.mjs), LAB_PASSWORD_FILE, KUBEADMIN_PASSWORD_FILE (scanned
// for; Secrets are read through the caller's cluster-admin oc login); OUT (default: the guide's
// images directory); DEBUG_DIR (failure text, outside the repo).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Take, VIEW, encode, executeBlocks, loadSecrets, mkdirp, openTerminal, publish, rel, runBlock, scan, scanSecretRefs, segments, selectRun, failedChecks, sleep, waitFast, withWorkDir } from "./lib.mjs";
import { MODULES } from "./steps.mjs";

const argv = process.argv.slice(2);
const fromIdx = argv.indexOf("--from");
const from = fromIdx >= 0 ? argv.splice(fromIdx, 2)[1] : null;
const toIdx = argv.indexOf("--to");
const to = toIdx >= 0 ? argv.splice(toIdx, 2)[1] : null;  // last exercise to record
if (!argv.length || argv[0] === "list") {
  for (const [m, d] of Object.entries(MODULES)) console.log(`${m}: ${d.exercises.map((e) => e.id).join(" ")}`);
  process.exit(0);
}
const todo = argv[0] === "all" ? Object.keys(MODULES) : argv;
for (const m of todo) if (!MODULES[m]) throw new Error(`unknown module ${m}`);
const plan = selectRun(MODULES, todo, from, to);

const domain = process.env.DOMAIN;
if (!domain || !process.env.STATE) throw new Error("DOMAIN and STATE are required");
const repo = process.env.REPO || rel("..", "..");
const out = process.env.OUT || path.join(repo, "content/modules/ROOT/assets/images");
const cfg = { domain, console: `https://console-openshift-console.${domain}`, dashboard: `https://rh-ai.${domain}`,
  www: path.join(repo, "www/modules") };
const readSecret = (ns, name, key) => {
  try {
    const b64 = execFileSync("oc", ["-n", ns, "get", "secret", name, "-o", `jsonpath={.data.${key}}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return Buffer.from(b64, "base64").toString().trim();
  } catch { return ""; }
};
// Re-read per module: the MaaS database password exists only from Module 5 on.
const secretsNow = (mod) => loadSecrets({ passwordFile: process.env.LAB_PASSWORD_FILE, kubeadminFile: process.env.KUBEADMIN_PASSWORD_FILE,
  stateFile: process.env.STATE, secretRefs: scanSecretRefs(mod) }, readSecret);

const { chromium } = await import("playwright");
mkdirp(out);
let failed = 0;
const browser = await chromium.launch();

async function recordModule(m, exercises, work) {
  const mod = MODULES[m];
  const blocks = executeBlocks(cfg.www, mod.page);
  // A failed re-recording must not leave the previous video looking current.
  if (mod.video !== false) for (const ex of exercises) fs.rmSync(path.join(out, `${ex.id}.mp4`), { force: true });
  const context = await browser.newContext({ storageState: process.env.STATE, viewport: VIEW, ignoreHTTPSErrors: true,
    recordVideo: { dir: path.join(work, m), size: VIEW } });
  const take = new Take(m, context);
  const pages = {};
  const termText = () => pages.term.evaluate(() => window.__rec?.termText() || "");
  const s = {
    take, cfg,
    async cam(name) {
      if (!pages[name]) pages[name] = await take.page(name);
      take.cam(name);
      await pages[name].bringToFront();
      return pages[name];
    },
    caption: (t, x, k) => take.caption(t, x, k),
    waitFast: (done, why) => waitFast(take, done, { why }),
    async run(i, opts = {}) {
      if (i >= blocks.length) throw new Error(`${mod.page} has ${blocks.length} execute blocks, not ${i + 1}`);
      const term = await s.cam("term");
      await runBlock(take, term, blocks[i], opts);
      for (let r = 0; opts.retryUntil && r < (opts.retries || 3) && !new RegExp(opts.retryUntil, "m").test(await termText()); r++) {
        await take.caption("Not ready yet", "The guide's note: wait 30 seconds and run the block again.", "warn");
        take.cut(); await sleep(30000); take.normal();
        await runBlock(take, term, blocks[i], opts);
      }
      // the block's last expected line, then the prompt: quiet polling can look idle before the output
      const last = (opts.expect || []).at(-1);
      if (last) await waitFast(take, async () => {
        const t = await termText();
        const rows = t.split("\n").filter((l) => l.trim());
        return new RegExp(last.re, "m").test(t) && /\$\s*$/.test(rows.at(-1) || "");
      }, { why: opts.why || "the output", timeout: 900000 });
      // checks across lines (e.g. two values must be equal), not drawn as a highlight
      const bad = failedChecks(opts.check, await termText());
      if (bad.length) throw new Error(`block ${i + 1}: ${bad.join("; ")}`);
      for (const e of opts.expect || []) {
        const n = await take.box("term", { term: e.re }, e.label, e.kind);
        if (!n) throw new Error(`block ${i + 1}: expected output /${e.re}/ is not on screen`);
        await sleep(2300);
      }
      await sleep(700);
    },
  };
  pages.term = await take.page("term");
  take.cut();
  await openTerminal(pages.term, cfg.console);
  const done = [];
  let failure = null;
  take.startSampling();
  for (const ex of exercises) {
    take.mark(ex.id);
    take.normal();
    await s.cam("term");
    await take.title(`${mod.title} · ${ex.title}`);
    await take.caption(ex.title, ex.intro);
    await sleep(3200);
    await take.caption(null, null);
    try {
      await ex.run(s);
      await take.clearBoxes();
      await take.caption(ex.title, "Matches the guide's expected result.", "ok");
      await sleep(1800);
      await take.snapshot();
      done.push({ id: ex.id, t: take.marks.at(-1).t });
    } catch (e) {
      failure = { id: ex.id, message: e.message };
      try {
        const text = await termText();
        if (!scan([text], secretsNow(mod)).length) console.error(`--- ${ex.id} terminal (last rows) ---\n${text.split("\n").filter((l) => l.trim()).slice(-25).join("\n")}`);
      } catch { /* the page is gone */ }
      break;
    }
  }
  take.stopSampling();
  const end = Date.now();
  const videos = Object.fromEntries(Object.entries(take.pages).map(([cam, p]) => [cam, p.video()]));
  await context.close();
  const sources = {};
  for (const [cam, v] of Object.entries(videos)) sources[cam] = await v.path();
  let published = true;
  if (mod.video === false) done.forEach((d) => console.log(`ok   ${d.id} (checked, no video)`));
  else published = publish({ take, done, end, out, secrets: secretsNow(mod),
    enc: (fromT, toT, file) => encode(segments(take, toT, fromT), sources, file) });
  if (!published) failed = 1;
  if (failure) { failed = 1; console.error(`FAIL ${failure.id}: ${failure.message}`); return false; }
  return published;
}

try {
  await withWorkDir(async (work) => {
    for (const { m, exercises } of plan) { console.log(`== ${m}`); if (!(await recordModule(m, exercises, work))) break; }
  });
} finally {
  await browser.close();
}
process.exit(failed);
