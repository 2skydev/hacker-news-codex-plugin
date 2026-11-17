import { spawn, spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";

const marketplaceName = "hacker-news-codex-plugin";
const pluginName = "hacker-news";
const serverName = "hacker-news";
const toolName = "open_reader";

class CheckError extends Error {}

// A server can launch its MCP workers in separate process groups. Capture only
// process IDs so an interrupted check can also clean up those descendants.
function descendants(root) {
  const list = spawnSync("/bin/ps", ["-ax", "-o", "pid=,ppid="], {
    encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 600,
  });
  const children = new Map();
  for (const row of (list.stdout || "").trim().split("\n")) {
    const [pid, parent] = row.trim().split(/\s+/).map(Number);
    if (pid > 0) {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(pid);
    }
  }
  const queue = [root];
  for (const pid of queue) queue.push(...(children.get(pid) || []));
  return queue.slice(1).reverse();
}

function signalProcess(pid, signal) {
  try { process.kill(pid, signal); } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

async function stop(server, lines) {
  const workers = server.pid ? descendants(server.pid) : [];
  lines.close();
  server.stdin.end();
  server.stdout.destroy();
  if (!server.pid) return;
  // Give the fresh server a chance to close its own transports on EOF first.
  await sleep(200);
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    signalProcess(-server.pid, signal);
    for (const pid of workers) signalProcess(pid, signal);
    if (signal === "SIGTERM") await sleep(200);
  }
  server.stdin.destroy();
}

async function check(binary) {
  let executable;
  try { executable = realpathSync(binary); } catch { throw new CheckError("지정한 Codex 실행 파일을 찾을 수 없습니다."); }
  const server = spawn(executable, ["app-server", "--listen", "stdio://"], {
    detached: true, stdio: ["pipe", "pipe", "ignore"],
  });
  const lines = createInterface({ input: server.stdout });
  let id = 0, pending, failure;
  function fail(message) {
    failure = new CheckError(message);
    pending?.reject(failure);
  }
  server.once("error", () => fail("지정한 Codex 실행 파일에서 앱 서버를 시작하지 못했습니다."));
  server.once("exit", () => fail("검사가 끝나기 전에 Codex 앱 서버가 종료됐습니다."));
  server.stdin.on("error", () => fail("Codex 앱 서버와의 연결이 끊겼습니다."));
  lines.on("line", line => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (!pending || message.id !== pending.id || message.method) return;
    if (message.error) pending.reject(new CheckError(pending.error));
    else pending.resolve(message.result);
  });
  function request(method, params, error) {
    if (failure) throw failure;
    const requestId = ++id;
    return new Promise((resolve, reject) => {
      pending = { id: requestId, resolve, reject, error };
      server.stdin.write(JSON.stringify({ id: requestId, method, params }) + "\n");
    });
  }
  const deadline = setTimeout(() => fail("Codex의 응답을 기다리다 설치 확인 시간이 초과됐습니다."), 46500);
  const interrupted = () => fail("설치 확인을 중단했습니다.");
  process.once("SIGINT", interrupted);
  process.once("SIGTERM", interrupted);
  try {
    await request("initialize", {
      clientInfo: { name: "hn_reader_install_check", title: "Hacker News 설치 확인", version: "1" },
      capabilities: { experimentalApi: true, requestAttestation: false },
    }, "Codex 앱 서버 초기화에 실패했습니다. 데스크톱 앱 버전을 확인해 주세요.");
    server.stdin.write('{"method":"initialized"}\n');

    const { marketplaces } = await request("plugin/list", { marketplaceKinds: ["local"] }, "Codex 마켓플레이스 목록을 읽지 못했습니다.");
    const market = marketplaces.find(entry => entry.name === marketplaceName && entry.path);
    if (!market) throw new CheckError("Codex에 Hacker News 마켓플레이스가 등록되지 않았습니다.");

    const { plugin } = await request("plugin/read", { marketplacePath: market.path, pluginName }, "Codex가 Hacker News 플러그인 정보를 읽지 못했습니다.");
    if (!plugin.summary?.installed || !plugin.summary.enabled) throw new CheckError("Codex에서 Hacker News 플러그인이 설치 및 활성화되어 있는지 확인해 주세요.");
    if (!plugin.mcpServers.includes(serverName)) throw new CheckError("데스크톱이 Hacker News 플러그인의 MCP 서버 선언을 읽지 못했습니다.");

    const status = await request("mcpServerStatus/list", { detail: "toolsAndAuthOnly", serverName }, "데스크톱이 Hacker News MCP 서버 상태를 읽지 못했습니다.");
    const entry = status.data.find(row => row.name === serverName && row.pluginId === plugin.summary.id);
    const reader = entry?.tools?.[toolName];
    if (!reader || reader.name !== toolName) throw new CheckError("데스크톱이 Hacker News 리더 도구를 찾지 못했습니다. MCP 서버 시작 상태를 확인해 주세요.");
    const meta = reader._meta;
    if (!meta?.ui?.resourceUri?.startsWith("ui://") || !meta["openai/ui"]?.entrypoints?.some(point => point.type === "global")) {
      throw new CheckError("Hacker News 리더의 사이드바 진입점이 데스크톱에 등록되지 않았습니다.");
    }
  } finally {
    clearTimeout(deadline);
    // Cleanup must finish even after a user interruption or an RPC timeout.
    await stop(server, lines);
    process.removeListener("SIGINT", interrupted);
    process.removeListener("SIGTERM", interrupted);
  }
}

if (process.argv.length !== 3) {
  console.error("사용법: node scripts/check-desktop.mjs <설치에 사용한 Codex 실행 파일 경로>");
  process.exitCode = 1;
} else {
  try {
    await check(process.argv[2]);
    console.log("데스크톱 앱 서버에서 Hacker News 리더와 사이드바 진입점을 확인했습니다.");
  } catch (error) {
    console.error(error instanceof CheckError ? error.message : "데스크톱 설치 확인 중 예상하지 못한 응답이 발생했습니다.");
    process.exitCode = 1;
  }
}
