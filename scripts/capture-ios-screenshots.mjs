// Capture iPhone 6.7" (1290x2796) App Store screenshots of the Expo web app.
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const BASE = `https://${process.env.REPLIT_EXPO_DEV_DOMAIN}`;
const OUT = "attached_assets/store-submission/screenshots/ios67";
mkdirSync(OUT, { recursive: true });

const EXEC = "/nix/store/m7qi78k6711fpwnrm4r2kn4p3ga3jal9-ungoogled-chromium-123.0.6312.105/bin/chromium";

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--disable-dev-shm-usage"] });

async function shot(page, name) {
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("saved", name);
}

async function login(page, email, password) {
  await page.goto(BASE + "/login", { waitUntil: "networkidle", timeout: 180000 });
  const emailInput = page.locator('input[placeholder="your@email.com"]').first();
  await emailInput.waitFor({ timeout: 180000 });
  await emailInput.fill(email);
  const passInput = page.locator('input[type="password"]').first();
  await passInput.fill(password);
  await page.getByText(/^(log in|sign in)$/i).first().click();
  await page.waitForTimeout(6000);
}

// 1290x2796 = 430x932 CSS px at 3x
const ctxOpts = { viewport: { width: 430, height: 932 }, deviceScaleFactor: 3, isMobile: true };

// ── Caregiver flow ──
{
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  await page.goto(BASE + "/login", { waitUntil: "networkidle", timeout: 180000 });
  await page.locator('input[placeholder="your@email.com"]').first().waitFor({ timeout: 180000 });
  await shot(page, "01-login");
  await login(page, "review.caregiver@terra-call.com", "AppleReview2026!Cg");
  await page.waitForTimeout(4000);
  await shot(page, "02-caregiver-dashboard");
  try { await page.getByText(/^map$/i).first().click({ timeout: 4000 }); await shot(page, "03-caregiver-map"); } catch {}
  await ctx.close();
}

// ── Recipient flow ──
{
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  await login(page, "review.recipient@terra-call.com", "AppleReview2026!Cr");
  await shot(page, "04-recipient-checkin");
  try { await page.getByText(/settings/i).first().click({ timeout: 4000 }); await shot(page, "05-recipient-settings"); } catch {}
  await ctx.close();
}

await browser.close();
console.log("done");
