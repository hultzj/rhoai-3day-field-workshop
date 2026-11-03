// Logs the participant user in once, never on camera, to the console and the OpenShift AI dashboard,
// and saves the browser session for the recordings.
// Usage: LAB_USER=kuro LAB_PASSWORD_FILE=~/.lab-rec/kuro.pw DOMAIN=apps.<cluster> node login.mjs <state.json>
// The session file is a credential: it is written mode 600, outside the repository.
import fs from "node:fs";
import { chromium } from "playwright";

const [stateFile] = process.argv.slice(2);
const user = process.env.LAB_USER, domain = process.env.DOMAIN, idp = process.env.IDP || "keycloak";
const password = fs.readFileSync(process.env.LAB_PASSWORD_FILE, "utf8").trim();
if (!stateFile || !user || !domain || !password) throw new Error("state file, LAB_USER, DOMAIN and LAB_PASSWORD_FILE are required");

const browser = await chromium.launch();
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
const page = await context.newPage();

// Whatever OpenShift OAuth asks for, in any order: identity provider, Keycloak form, authorize page.
async function signIn(done) {
  for (let i = 0; i < 25; i++) {
    if (await done.isVisible().catch(() => false)) return;
    const pick = page.getByRole("link", { name: new RegExp(`^${idp}$`, "i") });
    const form = page.locator("#kc-form-login #username");
    const allow = page.getByRole("button", { name: /Allow selected permissions/i });
    if (await pick.isVisible().catch(() => false)) await pick.click();
    else if (await form.isVisible().catch(() => false)) {
      await form.fill(user);
      await page.locator("#password").fill(password);
      await page.locator("#kc-login, [type=submit]").first().click();
    } else if (await allow.isVisible().catch(() => false)) await allow.click();
    await page.waitForTimeout(1500);
  }
  await done.waitFor({ timeout: 60000 });
}

await page.goto(`https://console-openshift-console.${domain}/`);
await signIn(page.getByRole("button", { name: "User menu" }).first());
console.log("console:", await page.title());
await page.goto(`https://rh-ai.${domain}/`);
await signIn(page.getByRole("link", { name: /^Projects$/ }).first());
const close = page.getByRole("button", { name: /^Close$/ });
if (await close.first().isVisible({ timeout: 5000 }).catch(() => false)) await close.first().click();
console.log("dashboard:", await page.title());

await context.storageState({ path: stateFile });
fs.chmodSync(stateFile, 0o600);
await browser.close();
