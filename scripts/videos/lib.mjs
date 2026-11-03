// Recording helpers for the workshop's step videos: in-page overlays (captions, highlight boxes, a
// speed badge), a driver for the OpenShift console's Web Terminal, and an edit list that cuts between
// the terminal and the console or dashboard, speeds up the waits, and encodes one MP4 per exercise of
// at most MAX_SECONDS. Ported from the NeMo Guardrails Evaluation lab's recorder.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const VIEW = { width: 1280, height: 720 };  // embedded at ~800 px: text stays legible
export const MAX_SECONDS = 120;
export const TAIL = 2;  // seconds the last frame is held at the end, inside the cap

// Installed into every page (and re-installed on navigation): pointer-events none, top-most.
const OVERLAY = () => {
  if (window.__rec) return;
  // Every text that enters the page, the moment it does, goes to the recorder's secret scan (the
  // __recText binding): nothing on screen is missed, however briefly it shows.
  const report = (t) => { if (t && t.trim() && window.__recText) window.__recText(t).catch(() => {}); };
  new MutationObserver((muts) => {
    const seen = [];
    for (const m of muts) {
      if (m.type === "characterData") seen.push(m.target.data);
      for (const n of m.addedNodes) seen.push(n.textContent || "");
    }
    report(seen.join("\n"));
  }).observe(document, { subtree: true, childList: true, characterData: true });  // the Document: survives document.open
  document.addEventListener("DOMContentLoaded", () => report(document.body.innerText));
  const css = `
  #__rec { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; font-family: "Red Hat Text", "Helvetica Neue", Arial, sans-serif; }
  #__rec .cap { position: absolute; left: 24px; bottom: 24px; max-width: 820px; background: rgba(21,21,21,.92); color: #fff;
    border-left: 6px solid #ee0000; border-radius: 6px; padding: 14px 18px; box-shadow: 0 6px 24px rgba(0,0,0,.35); transition: opacity .3s; }
  #__rec .cap.ok { border-left-color: #3e8635; }
  #__rec .cap.warn { border-left-color: #f0ab00; }
  #__rec .cap .t { font-size: 16px; letter-spacing: .04em; text-transform: uppercase; color: #f0f0f0; opacity: .8; margin-bottom: 4px; }
  #__rec .cap .x { font-size: 24px; line-height: 1.35; }
  #__rec .box { position: absolute; border: 3px solid #ee0000; border-radius: 6px; box-shadow: 0 0 0 4px rgba(238,0,0,.18); transition: all .25s; }
  #__rec .box.ok { border-color: #3e8635; box-shadow: 0 0 0 4px rgba(62,134,53,.2); }
  #__rec .box.info { border-color: #0066cc; box-shadow: 0 0 0 4px rgba(0,102,204,.18); }
  #__rec .box .l { position: absolute; top: -32px; left: -3px; background: #ee0000; color: #fff; font-size: 18px; font-weight: 600;
    padding: 3px 10px; border-radius: 4px 4px 4px 0; white-space: nowrap; }
  #__rec .box.ok .l { background: #3e8635; } #__rec .box.info .l { background: #0066cc; }
  #__rec .box.below .l { top: auto; bottom: -32px; border-radius: 0 4px 4px 4px; }
  #__rec .box.side .l { top: 50%; left: calc(100% + 10px); transform: translateY(-50%); border-radius: 4px; }
  #__rec .badge { position: absolute; top: 56px; right: 22px; background: #f0ab00; color: #151515; font-size: 22px; font-weight: 700;
    padding: 6px 14px; border-radius: 6px; box-shadow: 0 4px 16px rgba(0,0,0,.3); }
  #__rec .title { position: absolute; top: 4px; right: 56px; background: rgba(21,21,21,.9); color: #fff;
    font-size: 19px; padding: 6px 16px; border-radius: 6px; }`;
  const install = () => {
    if (document.getElementById("__rec")) return;
    const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    const root = document.createElement("div"); root.id = "__rec"; document.body.appendChild(root);
  };
  const root = () => { install(); return document.getElementById("__rec"); };
  const el = (cls, html) => { const d = document.createElement("div"); d.className = cls; d.innerHTML = html; return d; };
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  // Terminal rows as text, from xterm's screen-reader tree (JupyterLab setting screenReaderMode): one
  // div per visible row, laid over the canvas. Box width comes from the measured character width.
  // Terminal rows as text, from xterm's DOM renderer (the console Web Terminal): one div per row, drawn
  // where it sits, so each row's own box is its position.
  const termRows = () => {
    const term = [...document.querySelectorAll(".xterm")].find((t) => t.offsetParent);
    if (!term) return { rows: [], cw: 9, at: (i, b) => b };
    const m = term.querySelector(".xterm-char-measure-element");
    const cw = m && m.textContent.length ? m.getBoundingClientRect().width / m.textContent.length : 9;
    const rows = [...term.querySelectorAll(".xterm-rows > div")];
    const at = (i, b) => ({ left: b.left, top: b.top, bottom: b.bottom, width: b.width });
    return { rows, cw, at };
  };
  // Rows whose text matches re, merged into one rect per run of adjacent rows.
  const termRects = (re) => {
    const { rows, cw, at } = termRows();
    const out = [];
    out.matched = 0;  // matching rows (adjacent ones share a rect)
    let cur = null, last = -2;
    rows.forEach((r, i) => {
      const text = r.textContent.replace(/\s+$/, "");
      if (!new RegExp(re, "i").test(text)) return;
      out.matched++;
      const b = at(i, r.getBoundingClientRect());
      const right = b.left + Math.min(b.width, text.length * cw + 8);
      if (cur && i === last + 1) { cur.bottom = b.bottom; cur.right = Math.max(cur.right, right); }
      else { cur = { left: b.left, top: b.top, right, bottom: b.bottom }; out.push(cur); }
      last = i;
    });
    return out;
  };
  // Visible elements matching sel whose text matches re, innermost only: a page-wide selector must not
  // box the whole page because <body> also contains the text.
  const textEls = (sel, re) => {
    const all = [...document.querySelectorAll(sel)].filter((e) => e.offsetParent && (!re || new RegExp(re, "i").test(e.innerText || e.value || "")));
    return re ? all.filter((e) => !all.some((o) => o !== e && e.contains(o))) : all;
  };
  window.__rec = {
    // text is the recorder's own markup (<b>, <code>), never page or cluster data
    caption(title, text, kind = "") {
      root().querySelectorAll(".cap").forEach((c) => c.remove());
      if (text) root().appendChild(el(`cap ${kind}`, `<div class="t">${esc(title)}</div><div class="x">${text}</div>`));
    },
    title(text) { root().querySelectorAll(".title").forEach((c) => c.remove()); if (text) root().appendChild(el("title", esc(text))); },
    badge(text) { root().querySelectorAll(".badge").forEach((c) => c.remove()); if (text) root().appendChild(el("badge", esc(text))); },
    clearBoxes() {
      root().querySelectorAll(".box").forEach((c) => c.remove());
      root().querySelectorAll(".cap").forEach((c) => { c.style.opacity = ""; });  // nothing left to make room for
    },
    // target: {term: regex} | {sel, re} ; returns how many boxes were drawn
    box(target, label = "", kind = "", pad = 4) {
      let pick, matched;
      if (target.term) {
        const rects = termRects(target.term);
        pick = target.all ? rects : rects.slice(target.last ? -1 : 0, target.last ? undefined : 1);
        matched = target.all ? rects.matched : pick.length;
      } else {
        const els = textEls(target.sel, target.re);
        const chosen = target.all ? els : els.slice(target.last ? -1 : 0, target.last ? undefined : 1);
        if (chosen[0] && !target.noScroll) chosen[0].scrollIntoView({ block: "center", behavior: "instant" });
        pick = chosen.map((e) => e.getBoundingClientRect());
      }
      pick.forEach((b, i) => {
        // label beside the box when it fits (it covers nothing there), else above, or below at the top edge
        const side = b.right + 24 + label.length * 10.5 < window.innerWidth - 12;
        const below = !side && (b.top < 60 || target.term);  // terminal: the row below is usually the prompt
        const d = el(`box ${kind} ${side ? "side" : below ? "below" : ""}`, label && i === 0 ? `<div class="l">${esc(label)}</div>` : "");
        Object.assign(d.style, { left: `${b.left - pad}px`, top: `${b.top - pad}px`, width: `${b.right - b.left + 2 * pad}px`,
          height: `${b.bottom - b.top + 2 * pad}px` });
        root().appendChild(d);
        // a caption over the highlighted output fades out of the way
        const r = d.getBoundingClientRect();
        root().querySelectorAll(".cap").forEach((c) => {
          const k = c.getBoundingClientRect();
          if (r.bottom > k.top && r.top < k.bottom && r.right > k.left && r.left < k.right) c.style.opacity = "0.12";
        });
      });
      return matched ?? pick.length;  // terminal: rows matched, not boxes drawn
    },
    termText() { return termRows().rows.map((r) => r.textContent.replace(/\s+$/, "")).join("\n"); },
  };
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One recording: pages that share a time origin, plus the edit list.
export class Take {
  constructor(name, context) {
    this.name = name; this.context = context; this.pages = {}; this.born = {}; this.events = [];
    this.marks = [];  // exercises: {name, t}; each becomes its own video with its own secret scan
    this.textsBy = { _setup: new Set() };  // every distinct visible text seen, per exercise
    this.unreadBy = {};  // snapshots that could not read a page, per exercise: that video is discarded
    this.cur = "_setup";
  }
  get texts() { return this.textsBy[this.cur]; }
  get unread() { return this.unreadBy[this.cur] || 0; }
  set unread(v) { this.unreadBy[this.cur] = v; }
  // Starts the next exercise's video (and its own scan); setup before the first mark is never encoded.
  mark(name) { this.marks.push({ name, t: Date.now() }); this.cur = name; this.textsBy[name] = new Set(); }
  async page(cam) {
    if (!this.init) {  // context-wide, so pop-ups get both too
      await this.context.exposeBinding("__recText", (_source, text) => { this.textsBy[this.cur].add(text); });
      await this.context.addInitScript(OVERLAY);
      this.init = true;
    }
    const p = await this.context.newPage();
    return this.adopt(cam, p);
  }
  // A page the browser opened itself (a link with target=_blank): its video started just now.
  adopt(cam, p) {
    this.born[cam] = Date.now();
    this.pages[cam] = p;
    if (!this.events.length) this.events.push({ t: Date.now(), cam, speed: 1 });
    return p;
  }
  // Edit-list changes take effect now: which camera is shown, at which speed (0 cuts the stretch out).
  edit(change) { const prev = this.events.at(-1); this.events.push({ ...prev, ...change, t: Date.now() }); }
  cam(cam) { this.edit({ cam }); }
  fast(speed) { this.edit({ speed }); }
  cut() { this.edit({ speed: 0 }); }
  normal() { this.edit({ speed: 1 }); }
  async on(cam, fn, ...args) { const p = this.pages[cam]; await p.evaluate(OVERLAY); return p.evaluate(fn, args); }
  // The same overlay on every open page, so the camera can switch without the caption jumping.
  async all(fn, ...args) { for (const cam of Object.keys(this.pages)) await this.on(cam, fn, ...args); }
  caption(title, text, kind) { return this.all(([a, b, c]) => window.__rec.caption(a, b, c), title, text, kind); }
  title(text) { return this.all(([a]) => window.__rec.title(a), text); }
  badge(text) { return this.all(([a]) => window.__rec.badge(a), text); }
  clearBoxes() { return this.all(() => window.__rec.clearBoxes()); }
  box(cam, target, label, kind) { return this.on(cam, ([t, l, k]) => window.__rec.box(t, l, k), target, label, kind); }
  async read(p) { return p.evaluate(() => document.body.innerText + "\n" + (window.__rec?.termText() || "")); }
  // Everything visible, for the secret scan: page text plus the terminal rows. A page that cannot be
  // read after retries counts against the take: an uninspected take must not become a video.
  async snapshot() {
    for (const p of Object.values(this.pages)) {
      let ok = false;
      for (let i = 0; i < 3 && !ok; i++) {
        try { this.texts.add(await this.read(p)); ok = true; } catch { await sleep(500); }
      }
      if (!ok) this.unread++;
    }
  }
  // Text that is on screen only briefly (scrolled away, replaced) is caught by sampling all along.
  startSampling(ms = 250) {
    this.sampler = setInterval(() => {
      for (const p of Object.values(this.pages)) this.read(p).then((t) => this.texts.add(t), () => {});  // navigating: next sample
    }, ms);
  }
  stopSampling() { clearInterval(this.sampler); }
}

// The secret scan's verdict on a take: known secrets or credential shapes seen, or pages unread.
// What to record: the modules in order, from exercise `from` up to and including exercise `to`, across
// modules (so `all --to m1-ex1` records one exercise, never the cleanup after it).
export function selectRun(modules, todo, from, to) {
  const ids = todo.flatMap((m) => modules[m].exercises.map((e) => e.id));
  for (const [flag, id] of [["--from", from], ["--to", to]]) if (id && !ids.includes(id)) throw new Error(`${flag} ${id} is not among ${todo.join(" ")}`);
  const first = from ? ids.indexOf(from) : 0, last = to ? ids.indexOf(to) : ids.length - 1;
  if (first > last) throw new Error(`--from ${from} comes after --to ${to}`);
  const keep = new Set(ids.slice(first, last + 1));
  return todo.map((m) => ({ m, exercises: modules[m].exercises.filter((e) => keep.has(e.id)) })).filter((x) => x.exercises.length);
}

// A step's `check` entries against the terminal text: { re } must match, { absent } must not, and
// { fn } must return true. Returns the `why` of each that failed.
export function failedChecks(checks = [], text) {
  return checks.filter((c) => !(c.fn ? c.fn(text) : c.absent ? !new RegExp(c.absent, "m").test(text) : new RegExp(c.re, "m").test(text))).map((c) => c.why);
}

// Publishes each checked exercise's video unless its captured text fails the secret scan. Returns true
// only if every one was published: a caller must not go on (least of all to the cleanup) otherwise.
export function publish({ take, done, end, out, secrets, enc, log = console }) {
  let ok = true;
  done.forEach((d) => {
    const file = path.join(out, `${d.id}.mp4`);
    const nextT = take.marks.find((mk) => mk.t > d.t)?.t ?? end;
    const hits = inspect(take, secrets, d.id);
    if (hits.length) { ok = false; fs.rmSync(file, { force: true }); log.error(`FAIL ${d.id}: secret scan: ${hits.join(", ")}; video discarded`); return; }
    try {
      const r = enc(d.t, nextT, file);
      log.log(`ok   ${d.id}: ${r.seconds.toFixed(0)} s, ${(fs.statSync(file).size / 1e6).toFixed(1)} MB` + (r.factor > 1 ? `, waits sped up ${r.factor.toFixed(1)}x more` : ""));
    } catch (e) { ok = false; fs.rmSync(file, { force: true }); log.error(`FAIL ${d.id}: encode: ${e.message}`); }
  });
  return ok;
}

export function inspect(take, secrets, name = take.cur) {
  const texts = take.textsBy[name] || new Set();
  const hits = scan([...texts], secrets);
  if (take.unreadBy[name]) hits.push(`${take.unreadBy[name]} snapshot(s) could not read the page`);
  if (!texts.size) hits.push("no text was inspected");
  return hits;
}

// The secrets to scan for, held in memory only: the user's password files, the Keycloak admin
// password, every Secret in secretRefs ([ns, name, key]) and the session cookies. Each source must
// yield a value: a scan missing one would pass a video that shows it. readSecret returns "" on failure.
// The MaaS database password exists from Module 5 on; a module flagged dbSecret must be able to read it
// (fail closed), others scan for it only if it happens to exist.
export const scanSecretRefs = (mod) => [["redhat-ods-applications", "postgres-creds", "POSTGRESQL_PASSWORD", !mod.dbSecret]];

export function loadSecrets({ passwordFile, kubeadminFile, stateFile, secretRefs = [] }, readSecret) {
  const read = (f, what) => {
    const v = f && fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim() : "";
    if (!v) throw new Error(`cannot load ${what} to scan for (${f || "not set"})`);
    return v;
  };
  const out = [read(passwordFile, "the user's password")];
  if (kubeadminFile) out.push(read(kubeadminFile, "the kubeadmin password"));
  for (const [ns, name, key, optional] of secretRefs) {
    const v = readSecret(ns, name, key);
    if (!v && !optional) throw new Error(`cannot load Secret ${ns}/${name} to scan for (oc login as cluster-admin?)`);
    if (v) out.push(v);
  }
  // The session cookies are credentials too.
  if (stateFile) for (const c of JSON.parse(fs.readFileSync(stateFile, "utf8")).cookies || []) if (c.value?.length >= 16) out.push(c.value);
  return out;
}

// Failure diagnostics, only when the page text scans clean; files mode 600, outside the repository.
export function writeDebug(dir, base, text, png, secrets) {
  if (!text || !text.trim() || scan([text], secrets).length) return false;  // unread is not clean
  fs.writeFileSync(path.join(dir, `${base}.txt`), text, { mode: 0o600 });
  if (png) fs.writeFileSync(path.join(dir, `${base}.png`), png, { mode: 0o600 });
  return true;
}

// One step, end to end: run it, close the recording, inspect it, encode it. A step that failed, or
// whose inspection found anything, produces no file; a failed encode leaves no partial file.
export async function produce({ run, finish, inspectFn, encodeFn, outFile }) {
  let failure = null, sources;
  try { await run(); } catch (e) { failure = e.message; }
  try { sources = await finish(failure); } catch (e) { failure ??= `closing the recording failed: ${e.message}`; }
  if (failure) return { ok: false, reason: failure };
  const hits = inspectFn();
  if (hits.length) return { ok: false, reason: `secret scan: ${hits.join(", ")}; video discarded` };
  try {
    return { ok: true, ...encodeFn(sources) };
  } catch (e) {
    fs.rmSync(outFile, { force: true });
    return { ok: false, reason: `encode failed: ${e.message}` };
  }
}

// --- OpenShift Web Terminal ---------------------------------------------------------------

// The full-page Web Terminal (/terminal): the same terminal as the console drawer, with room to read.
export async function openTerminal(page, consoleUrl) {
  await page.goto(`${consoleUrl}/terminal`, { waitUntil: "domcontentloaded" });
  const start = page.locator("form").filter({ hasText: "This Project will be used" }).getByRole("button", { name: "Start", exact: true });
  for (let i = 0; i < 90; i++) {
    if (await start.isVisible().catch(() => false)) await start.click();
    if (/\$\s*$/m.test(await termText(page).catch(() => ""))) break;
    await sleep(2000);
  }
  await waitPrompt(page, 120000);
}

const termText = (page) => page.evaluate(() => window.__rec?.termText() || "");

// The shell is idle: the last non-empty row is a prompt, and the text has stopped changing.
export async function waitPrompt(page, timeout = 600000, settle = 1500) {
  const end = Date.now() + timeout;
  let prev = "", since = Date.now();
  while (Date.now() < end) {
    const t = await termText(page);
    if (t !== prev) { prev = t; since = Date.now(); }
    const lastRow = t.split("\n").filter((l) => l.trim()).at(-1) || "";
    if (/\$\s*$/.test(lastRow) && Date.now() - since > settle) return t;
    await sleep(300);
  }
  throw new Error("terminal did not return to a prompt");
}

// Pastes the block the way a participant does (a clipboard paste: bash holds it, bracketed, until
// Enter), then presses Enter.
export async function typeBlock(page, block) {
  const paste = () => page.evaluate((text) => {
    const ta = document.querySelector(".xterm-helper-textarea");
    ta.focus();
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    ta.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, block);
  const before = await termText(page);
  const changed = async (ms) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) if ((await termText(page)) !== before) return true;
    return false;
  };
  await paste();
  if (!(await changed(4000))) { await paste(); if (!(await changed(4000))) throw new Error("paste did not reach the terminal"); }
  await sleep(600);
  await page.keyboard.press("Enter");
}

// Waits on `done()`; past `after` ms the take speeds up and shows a badge, back to real time once done.
export async function waitFast(take, done, { after = 4000, speed = 12, why = "waiting", timeout = 1800000 } = {}) {
  const t0 = Date.now();
  let fast = false;
  try {
    while (!(await done())) {
      if (Date.now() - t0 > timeout) throw new Error(`timed out: ${why}`);
      if (!fast && Date.now() - t0 > after) { fast = true; take.fast(speed); await take.badge(`⏩ sped up · ${why}`); }
      await sleep(400);
    }
  } finally {
    if (fast) { await take.badge(null); take.normal(); }
  }
}

// Clears the screen off camera, pastes the block, and waits (sped up) for the prompt to return.
export async function runBlock(take, page, block, opts = {}) {
  await take.clearBoxes();
  take.cut();
  await typeBlock(page, "clear");
  await waitPrompt(page, 30000, 500);
  take.normal();
  await typeBlock(page, block);
  await sleep(800);
  let prev = "", since = Date.now();
  await waitFast(take, async () => {
    const t = await termText(page);
    if (t !== prev) { prev = t; since = Date.now(); }
    const lastRow = t.split("\n").filter((l) => l.trim()).at(-1) || "";
    return /\$\s*$/.test(lastRow) && Date.now() - since > 1500;
  }, { why: opts.why || "the command to finish", after: opts.after, timeout: opts.timeout });
  await take.snapshot();
  return prev;
}

// --- The built guide --------------------------------------------------------------------------

const ENT = { "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&#39;": "'", "&#8217;": "’", "&#8230;": "…" };
// The page's click-to-run (role="execute") bash blocks, in guide order, as a participant copies them.
export function executeBlocks(www, page) {
  const html = fs.readFileSync(path.join(www, `${page}.html`), "utf8");
  return [...html.matchAll(/<div class="listingblock execute">[\s\S]*?<code class="language-bash[^"]*" data-lang="bash">([\s\S]*?)<\/code>/g)]
    .map((m) => m[1].replace(/<[^>]+>/g, "").replace(/&[#a-z0-9]+;/g, (e) => ENT[e] ?? e));
}

// --- Editing ----------------------------------------------------------------------------------

// The edit list as segments of source video: [{cam, from, to, speed}], cut stretches dropped.
// The edit list between `from` and `to` (one exercise) as segments of source video.
export function segments(take, endT, fromT = 0) {
  const ev = [...take.events, { t: endT }];
  const out = [];
  for (let i = 0; i < ev.length - 1; i++) {
    const { cam, speed } = ev[i];
    const a = Math.max(ev[i].t, fromT), b = Math.min(ev[i + 1].t, endT);
    if (!speed || b - a < 50) continue;
    out.push({ cam, from: (a - take.born[cam]) / 1000, to: (b - take.born[cam]) / 1000, speed });
  }
  return out;
}

const length = (segs) => segs.reduce((a, s) => a + (s.to - s.from) / s.speed, 0);

// Over the cap: speed up the already-fast stretches further, never the real-time ones.
export function fitSpeeds(segs, maxSeconds = MAX_SECONDS) {
  const budget = maxSeconds - TAIL;
  const total = length(segs);
  const fast = length(segs.filter((s) => s.speed > 1));
  if (total - fast > budget - 1) throw new Error(`real-time stretches alone run ${(total - fast).toFixed(0)} s: shorten the step`);
  const factor = total > budget ? fast / (budget - (total - fast)) : 1;
  return { segs: factor > 1 ? segs.map((s) => (s.speed > 1 ? { ...s, speed: s.speed * factor } : s)) : segs, factor };
}

export function encode(input, sources, outFile, maxSeconds = MAX_SECONDS) {
  const { segs, factor } = fitSpeeds(input, maxSeconds);
  const total = length(segs);
  const args = ["-y", "-loglevel", "error"];
  const filters = [];
  segs.forEach((s, i) => {
    args.push("-ss", s.from.toFixed(3), "-t", (s.to - s.from).toFixed(3), "-i", sources[s.cam]);
    filters.push(`[${i}:v]setpts=(PTS-STARTPTS)/${s.speed},fps=25,scale=${VIEW.width}:${VIEW.height},setsar=1[v${i}]`);
  });
  filters.push(`${segs.map((_, i) => `[v${i}]`).join("")}concat=n=${segs.length}:v=1:a=0,tpad=stop_mode=clone:stop_duration=${TAIL}[out]`);
  args.push("-filter_complex", filters.join(";"), "-map", "[out]", "-c:v", "libx264", "-preset", "slow", "-crf", "27",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", outFile);
  execFileSync("ffmpeg", args, { stdio: "inherit" });
  return { seconds: total + TAIL, factor };
}

// Visible text from every snapshot must not contain a known secret or a credential-shaped string.
export function scan(texts, secrets) {
  const hits = [];
  const pats = [/sha256~[A-Za-z0-9_-]{20,}/, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, /\bsk-[A-Za-z0-9]{20,}/, /\bsk-oai-[A-Za-z0-9_-]{16,}/, /-----BEGIN [A-Z ]*PRIVATE KEY/];
  for (const raw of texts) {
    // as shown, and with line breaks removed: a terminal wraps a long value across rows
    for (const t of [raw, raw.replace(/[ \t]*\n[ \t]*/g, "")]) {
      for (const s of secrets) if (s && t.includes(s)) hits.push("known secret");
      for (const p of pats) if (p.test(t)) hits.push(String(p));
    }
  }
  return [...new Set(hits)];
}

export const mkdirp = (d) => fs.mkdirSync(d, { recursive: true });

// A private directory for raw recordings, removed however fn ends: unscanned frames never stay on disk.
export async function withWorkDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-rec-"));
  const remove = () => fs.rmSync(dir, { recursive: true, force: true });
  // Ctrl-C or a kill must not leave them either: finally blocks do not run on a signal.
  const onSignal = (sig) => { remove(); process.exit(sig === "SIGINT" ? 130 : 143); };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try { return await fn(dir); } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    remove();
  }
}

// A failure screenshot with the page text read before and after it, so whatever the screenshot
// shows was on screen at one of the two reads (or in between, which the take's own scan covers).
export async function captureDebug(page, read) {
  const before = await read(page).catch(() => "");
  const png = await page.screenshot().catch(() => null);
  const after = await read(page).catch(() => "");
  return { text: before && after ? `${before}\n${after}` : "", png };
}
export const rel = (...p) => path.join(path.dirname(new URL(import.meta.url).pathname), ...p);
