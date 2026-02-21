import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const serverRoot = path.resolve(repoRoot, "apps/server");
const isWin = process.platform === "win32";
const defaultBunExe = isWin ? "C:\\Users\\breno\\.bun\\bin\\bun.exe" : "bun";
const bunExe = process.env.BUN_EXE || defaultBunExe;
const port = Number(process.env.UI_SMOKE_PORT || 3100);
const baseUrl = process.env.UI_SMOKE_BASE_URL || `http://127.0.0.1:${port}`;
const dbUrl = process.env.UI_SMOKE_DB_URL || "data/ui-smoke.sqlite";
const headless = process.env.UI_SMOKE_HEADLESS !== "false";
const runId = Date.now().toString(36);
const groupName = `UI Smoke ${runId}`;
const messageText = `ui smoke message ${runId}`;

let serverProc = null;
let browser = null;

function log(message) {
  process.stdout.write(`[ui-smoke] ${message}\n`);
}

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function runBun(args, env) {
  const result = spawnSync(bunExe, args, {
    cwd: repoRoot,
    env,
    encoding: "utf8",
    stdio: "pipe"
  });

  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n");
    fail(`Command failed: ${bunExe} ${args.join(" ")}\n${detail}`);
  }
}

async function waitForServerReady(timeoutMs = 25_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  fail(`Server did not become ready at ${baseUrl}/health within ${timeoutMs}ms`);
}

function startServer(env) {
  const args = ["run", "start"];
  serverProc = spawn(bunExe, args, {
    cwd: repoRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  serverProc.stdout.on("data", (chunk) => {
    process.stdout.write(`[server] ${chunk}`);
  });

  serverProc.stderr.on("data", (chunk) => {
    process.stderr.write(`[server] ${chunk}`);
  });
}

async function stopServer() {
  if (!serverProc) return;

  const proc = serverProc;
  serverProc = null;

  if (proc.killed) return;

  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      resolve();
    }, 4000);

    proc.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });

    proc.kill("SIGTERM");
  });
}

async function openBrowser() {
  try {
    return await chromium.launch({ channel: "msedge", headless });
  } catch (error) {
    log(`Edge channel unavailable, fallback to default chromium: ${error.message}`);
    return chromium.launch({ headless });
  }
}

async function waitForToastText(page, textMatchers, timeoutMs = 10_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const values = await page.locator("#toastContainer .toast").allInnerTexts();
    const hasMatch = values.some((value) => textMatchers.some((matcher) => matcher.test(value)));
    if (hasMatch) {
      return;
    }

    await page.waitForTimeout(120);
  }

  fail(`Expected toast not found. Matchers: ${textMatchers.map((v) => v.toString()).join(", ")}`);
}

async function waitForMemberRow(page, userLabel, timeoutMs = 8_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const row = page.locator("#membersList .member-row", {
      hasText: userLabel
    });

    if ((await row.count()) > 0) {
      return row.first();
    }

    await page.waitForTimeout(150);
  }

  fail(`Member row not found for ${userLabel}`);
}

async function clickMemberAction(page, userLabel, action) {
  const row = await waitForMemberRow(page, userLabel);
  const button = row.locator(`button[data-action="${action}"]`).first();
  const count = await button.count();
  assert(count > 0, `Action ${action} unavailable for user ${userLabel}`);
  await button.click();
}

function cleanSmokeDb() {
  const absoluteDbPath = path.isAbsolute(dbUrl) ? dbUrl : path.resolve(serverRoot, dbUrl);
  rmSync(absoluteDbPath, { force: true });
  rmSync(`${absoluteDbPath}-wal`, { force: true });
  rmSync(`${absoluteDbPath}-shm`, { force: true });
}

async function run() {
  const env = {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || "development",
    HOST: "127.0.0.1",
    PORT: String(port),
    DB_DRIVER: "sqlite",
    DB_URL: dbUrl
  };

  cleanSmokeDb();

  log("Running DB migrate + seed");
  runBun(["run", "db:migrate"], env);
  runBun(["run", "db:seed"], env);

  log("Starting server");
  startServer(env);
  await waitForServerReady();
  log(`Server is ready at ${baseUrl}`);

  browser = await openBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

  log("Opening app and logging in");
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.fill("#usernameInput", "alice");
  await page.fill("#passwordInput", "password123");
  await page.fill("#deviceIdInput", `ui-smoke-${runId}`);
  await page.click("#loginBtn");

  await page.waitForSelector("#app:not([hidden])", { timeout: 12_000 });
  await page.waitForSelector(".room-item", { timeout: 12_000 });

  log("Selecting a room and sending a message");
  await page.locator(".room-item").first().click();
  await page.fill("#messageInput", messageText);
  await page.click("#sendBtn");
  await page.locator(".bubble", { hasText: messageText }).first().waitFor({ timeout: 8_000 });

  log("Creating DM");
  await page.click("#createDmBtn");
  await page.fill(".modal input", "bob");
  await page.click(".modal button:has-text('Criar DM')");
  await waitForToastText(page, [/DM criado/i, /DM ja existente/i]);

  log("Creating group");
  await page.click("#createGroupBtn");
  await page.fill(".modal input", groupName);
  await page.fill(".modal textarea", "bob,carlos");
  await page.click(".modal button:has-text('Criar Grupo')");
  await waitForToastText(page, [/Grupo criado/i]);

  const newGroupItem = page.locator(".room-item", { hasText: groupName }).first();
  await newGroupItem.waitFor({ timeout: 8_000 });
  await newGroupItem.click();

  log("Managing members: add/promote/remove and transfer owner");
  await page.fill("#addMemberInput", "diana");
  await page.click("#addMemberBtn");
  await waitForToastText(page, [/Membro adicionado/i, /ja era membro/i]);

  await clickMemberAction(page, "diana", "promote");
  await waitForToastText(page, [/Promovido:/i]);

  await clickMemberAction(page, "carlos", "remove");
  await page.click(".modal button:has-text('Remover')");
  await waitForToastText(page, [/Removido:/i]);

  await clickMemberAction(page, "bob", "transfer");
  await page.click(".modal button:has-text('Transferir')");
  await waitForToastText(page, [/Ownership transferido/i]);

  log("Validating audit panel");
  await page.click("#tabAudit");
  await page.waitForSelector("#auditList .audit-row", { timeout: 10_000 });
  const auditText = await page.locator("#auditList").innerText();
  assert(auditText.includes("owner_transferred"), "Audit panel does not include owner_transferred event");

  await context.close();

  log("UI smoke test completed successfully");
}

async function cleanup(exitCode = 0) {
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }

  await stopServer();

  process.exitCode = exitCode;
}

process.on("SIGINT", async () => {
  await cleanup(130);
});
process.on("SIGTERM", async () => {
  await cleanup(143);
});

try {
  await run();
  await cleanup(0);
} catch (error) {
  process.stderr.write(`[ui-smoke] FAILED: ${error?.stack || error}\n`);
  await cleanup(1);
}
