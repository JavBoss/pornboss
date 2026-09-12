#!/usr/bin/env node
import inquirer from "inquirer";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
function findRepoRoot(startDir) {
  let dir = startDir;
  while (true) {
    if (fs.existsSync(path.join(dir, "go.mod"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}

function entryDirFromArgv() {
  const entry = process.argv[1];
  if (!entry) return process.cwd();
  const resolved = path.resolve(entry);
  try {
    const stat = fs.statSync(resolved);
    if (stat.isFile()) return path.dirname(resolved);
  } catch {
    // fall back to cwd
  }
  return path.dirname(resolved);
}

const ROOT_DIR = findRepoRoot(entryDirFromArgv());
const WEB_DIR = path.join(ROOT_DIR, "web");
const INTERNAL_BIN_DIR = path.join(ROOT_DIR, "internal", "bin");
const BIN_DIR = path.join(ROOT_DIR, "bin");

const PLATFORM_CHOICES = [
  { label: "windows-x86_64", goos: "windows", goarch: "amd64" },
  { label: "linux-x86_64", goos: "linux", goarch: "amd64" },
  { label: "macos-x86_64", goos: "darwin", goarch: "amd64" },
  { label: "macos-arm64", goos: "darwin", goarch: "arm64" },
];

const PLATFORM_BY_LABEL = new Map(PLATFORM_CHOICES.map((p) => [p.label, p]));
const FF_BINARY_DOWNLOADS = new Map([
  [
    "windows-x86_64",
    {
      ffmpeg: "https://github.com/shaka-project/static-ffmpeg-binaries/releases/download/n8.1.2-1/ffmpeg-win-x64.exe",
      ffmpegSHA256: "4044b3924c977ad31229d504c5d5b8685f9553124fbaff6e9c99048b42830341",
      ffprobe: "https://github.com/shaka-project/static-ffmpeg-binaries/releases/download/n8.1.2-1/ffprobe-win-x64.exe",
      ffprobeSHA256: "fc37ca23d31ee08bb8f7e108edf3822f6ef3efc1a8d306bbe0b779190230710b",
    },
  ],
  [
    "linux-x86_64",
    {
      ffmpeg: "https://github.com/shaka-project/static-ffmpeg-binaries/releases/download/n8.1.2-1/ffmpeg-linux-x64",
      ffmpegSHA256: "9eac5b2b5076db5ff853a6fa0dcd6b8de7d0cac8481eadda6c47cd935825f1ee",
      ffprobe: "https://github.com/shaka-project/static-ffmpeg-binaries/releases/download/n8.1.2-1/ffprobe-linux-x64",
      ffprobeSHA256: "065d3c56926052a76e884c4e4b51b7d95248da9391ab7effdcca6b94ceab98cf",
    },
  ],
  // TODO: macOS 暂时保留 FFmpeg/FFprobe 6.1.1。Shaka 8.1.2 构建最低要求
  // macOS 15，无法兼容目前仍需支持的 macOS 12–14；其他兼容构建又会让发布包
  // 增大 20 MB 以上。等 macOS 15 已足够老、可作为项目最低支持版本时再升级。
  [
    "macos-x86_64",
    {
      ffmpeg: "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-x64.gz",
      ffmpegDownloadSHA256: "929b375c1182d956c51f7ac25e0b2b0411fb01f6f407aa15c9758efeb4242106",
      ffmpegSHA256: "ebdddc936f61e14049a2d4b549a412b8a40deeff6540e58a9f2a2da9e6b18894",
      ffprobe: "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffprobe-darwin-x64.gz",
      ffprobeDownloadSHA256: "d4da574d6e2e197bd259b47d69cf262df9e312af24ad960444f6d806d3d4c186",
      ffprobeSHA256: "fa3add0ce901f7241abe0dfc0155d958fc834aca3f8ce61f87cc712ae669c1e0",
    },
  ],
  [
    "macos-arm64",
    {
      ffmpeg: "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-arm64.gz",
      ffmpegDownloadSHA256: "8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa",
      ffmpegSHA256: "a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584",
      ffprobe: "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffprobe-darwin-arm64.gz",
      ffprobeDownloadSHA256: "d986a8ec7b030899fe66a8a288ed809a3543338705a3ce178cfb85869c5d80be",
      ffprobeSHA256: "bb2db6f5d8cef919da12fbf592119a987202a8c060a886f3cab091f9cab90b64",
    },
  ],
]);

function normalizeGoos(input) {
  const v = String(input || "").trim().toLowerCase();
  if (v === "macos" || v === "osx") return "darwin";
  if (v === "win32") return "windows";
  return v;
}

function normalizeArch(input) {
  const v = String(input || "").trim().toLowerCase();
  if (v === "x86_64" || v === "amd64" || v === "x64") return "amd64";
  if (v === "aarch64" || v === "arm_64") return "arm64";
  return v;
}

function platformFromGoosArch(goos, arch) {
  const normalizedGoos = normalizeGoos(goos);
  const normalizedArch = normalizeArch(arch);
  return PLATFORM_CHOICES.find(
    (p) => p.goos === normalizedGoos && p.goarch === normalizedArch,
  );
}

function platformFromLabel(label) {
  if (PLATFORM_BY_LABEL.has(label)) return PLATFORM_BY_LABEL.get(label);
  return null;
}

function parsePlatformInput(input) {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  if (PLATFORM_BY_LABEL.has(raw)) return PLATFORM_BY_LABEL.get(raw);

  if (raw.includes("/") || raw.includes("-")) {
    const parts = raw.includes("/") ? raw.split("/") : raw.split("-");
    if (parts.length === 2) {
      const goos = normalizeGoos(parts[0]);
      const goarch = normalizeArch(parts[1]);
      return platformFromGoosArch(goos, goarch);
    }
  }

  return null;
}

function currentPlatformChoice() {
  const goos = os.platform();
  const goarch = os.arch();
  return platformFromGoosArch(goos, goarch);
}

function ffprobeBinName(goos) {
  return goos === "windows" ? "ffprobe.exe" : "ffprobe";
}

function ffmpegBinName(goos) {
  return goos === "windows" ? "ffmpeg.exe" : "ffmpeg";
}

function ffprobePath(choice) {
  return path.join(INTERNAL_BIN_DIR, ffprobeBinName(choice.goos));
}

function ffmpegPath(choice) {
  return path.join(INTERNAL_BIN_DIR, ffmpegBinName(choice.goos));
}

function internalMpvDir() {
  return path.join(INTERNAL_BIN_DIR, "mpv");
}

function platformBinDir(choice) {
  return path.join(BIN_DIR, choice.label);
}

function binFfprobePath(choice) {
  return path.join(platformBinDir(choice), ffprobeBinName(choice.goos));
}

function binFfmpegPath(choice) {
  return path.join(platformBinDir(choice), ffmpegBinName(choice.goos));
}

function binMpvDir(choice) {
  return path.join(platformBinDir(choice), "mpv");
}

function mpvExecutablePath(baseDir, choice) {
  if (choice.goos === "darwin") {
    return path.join(baseDir, "mpv.app", "Contents", "MacOS", "mpv");
  }
  return path.join(baseDir, choice.goos === "windows" ? "mpv.exe" : "mpv");
}

function binMpvPath(choice) {
  return mpvExecutablePath(binMpvDir(choice), choice);
}

function internalMpvPath(choice) {
  return mpvExecutablePath(internalMpvDir(), choice);
}

async function exists(filePath) {
  try {
    await fsp.access(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function envBool(name) {
  const value = String(process.env[name] || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

async function isExecutable(filePath) {
  if (process.platform === "win32") {
    return exists(filePath);
  }
  try {
    await fsp.access(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function isFfprobeReady(filePath, choice) {
  const expected = FF_BINARY_DOWNLOADS.get(choice.label)?.ffprobeSHA256;
  const binaryReady = choice.goos === "windows" ? await exists(filePath) : await isExecutable(filePath);
  if (!binaryReady) return false;
  if (!expected) return true;
  try {
    return (await sha256File(filePath)) === expected;
  } catch {
    return false;
  }
}

async function isFfmpegReady(filePath, choice) {
  const expected = FF_BINARY_DOWNLOADS.get(choice.label)?.ffmpegSHA256;
  const binaryReady = choice.goos === "windows" ? await exists(filePath) : await isExecutable(filePath);
  if (!binaryReady) return false;
  if (!expected) return true;
  try {
    return (await sha256File(filePath)) === expected;
  } catch {
    return false;
  }
}

async function isBundledFfprobeReady(choice) {
  return isFfprobeReady(binFfprobePath(choice), choice);
}

async function isBundledFfmpegReady(choice) {
  return isFfmpegReady(binFfmpegPath(choice), choice);
}

async function isBundledMpvReady(choice) {
  if (!(await exists(binMpvPath(choice)))) return false;
  if (choice.goos === "linux") {
    return isLinuxMpvBundleReady(binMpvDir(choice), choice);
  }
  return true;
}

function runCommand(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${cmd} exited with code ${code}`));
      }
    });
  });
}

function runCommandCapture(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${cmd} exited with code ${code}: ${stderr || stdout}`));
      }
    });
  });
}

function commandExists(cmd) {
  return new Promise((resolve) => {
    const probe = process.platform === "win32" ? "where" : "which";
    const child = spawn(probe, [cmd], { stdio: "ignore" });
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

async function resolveDevBinaryPath(envKey, bundledPath, commandName) {
  if (process.env[envKey]) return process.env[envKey];
  if (await isExecutable(bundledPath)) return bundledPath;
  if (await commandExists(commandName)) return commandName;
  return "";
}

async function ensureNpmDeps(cwd) {
  if (process.env.SKIP_NPM_INSTALL === "1") return;
  const nodeModules = path.join(cwd, "node_modules");
  if (fs.existsSync(nodeModules)) return;
  const hasLock = fs.existsSync(path.join(cwd, "package-lock.json"));
  await runCommand("npm", [hasLock ? "ci" : "install"], { cwd });
}

async function buildWeb() {
  if (process.env.SKIP_WEB_BUILD === "1") {
    console.log("[release] SKIP_WEB_BUILD=1，跳过前端构建");
    return;
  }
  console.log("[release] 构建前端 web/dist");
  await ensureNpmDeps(WEB_DIR);
  await runCommand("npm", ["run", "build"], { cwd: WEB_DIR });
}

async function runFrontendDev() {
  await ensureNpmDeps(WEB_DIR);
  console.log("[dev] 启动前端开发服务器");
  await runCommand("npm", ["run", "dev"], { cwd: WEB_DIR });
}

function waitForExit(child, label) {
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} exited with code ${code}`));
    });
  });
}

async function startBackendDevChild() {
  const current = currentPlatformChoice();
  if (!current) {
    console.error("[dev] 当前系统不在支持列表内，无法确定 ffprobe 平台");
    process.exitCode = 1;
    return null;
  }

  let ffprobeOk = await isFfprobeReady(ffprobePath(current), current);
  if (!ffprobeOk) {
    if (await isBundledFfprobeReady(current)) {
      const binFfprobe = binFfprobePath(current);
      await fsp.mkdir(INTERNAL_BIN_DIR, { recursive: true });
      await fsp.copyFile(binFfprobe, ffprobePath(current));
      if (current.goos !== "windows") {
        await fsp.chmod(ffprobePath(current), 0o755);
      }
      ffprobeOk = true;
    }
  }
  if (!ffprobeOk) {
    console.error(
      `[dev] internal/bin 缺少或版本不匹配 ${current.label} 的 ffprobe，请先选择 “download-dependencies” 下载到 bin/${current.label}。`,
    );
    process.exitCode = 1;
    return null;
  }

  if (current.goos === "darwin") {
    let ffmpegOk = await isFfmpegReady(ffmpegPath(current), current);
    if (!ffmpegOk) {
      if (await isBundledFfmpegReady(current)) {
        const binFfmpeg = binFfmpegPath(current);
        await fsp.mkdir(INTERNAL_BIN_DIR, { recursive: true });
        await fsp.copyFile(binFfmpeg, ffmpegPath(current));
        await fsp.chmod(ffmpegPath(current), 0o755);
        ffmpegOk = true;
      }
    }
    if (!ffmpegOk) {
      console.error(
        `[dev] internal/bin 缺少 ${current.label} 的 ffmpeg，请先选择 “download-dependencies” 下载到 bin/${current.label}。`,
      );
      process.exitCode = 1;
      return null;
    }
  }

  await syncBundledMpvToInternal(current);

  const args = ["./cmd/server"];
  console.log(`[dev] 后端启动：go run ${args.join(" ")}`);
  const env = {
    ...process.env,
    GOCACHE: path.join(ROOT_DIR, ".gocache"),
  };
  if (envBool("DOCKER_MODE")) {
    env.JAVBOSS_CONTAINER = env.JAVBOSS_CONTAINER || "1";
    env.JAVBOSS_DISABLE_DESKTOP_INTEGRATION =
      env.JAVBOSS_DISABLE_DESKTOP_INTEGRATION || "1";
    env.JAVBOSS_DISABLE_MPV = env.JAVBOSS_DISABLE_MPV || "1";
    env.JAVBOSS_USE_FFMPEG_SCREENSHOTS = env.JAVBOSS_USE_FFMPEG_SCREENSHOTS || "1";
    env.FFPROBE_PATH =
      (await resolveDevBinaryPath("FFPROBE_PATH", ffprobePath(current), "ffprobe")) ||
      env.FFPROBE_PATH;
    env.FFMPEG_PATH =
      (await resolveDevBinaryPath("FFMPEG_PATH", ffmpegPath(current), "ffmpeg")) ||
      env.FFMPEG_PATH;
    if (!env.FFMPEG_PATH) {
      console.error("[dev] DOCKER_MODE=1 需要 ffmpeg，请设置 FFMPEG_PATH 或安装 ffmpeg。");
      process.exitCode = 1;
      return null;
    }
    console.log("[dev] Docker 模式配置已启用");
  }
  const child = spawn("go", ["run", ...args], { cwd: ROOT_DIR, env, stdio: "inherit" });
  return child;
}

async function runBackendDev() {
  const child = await startBackendDevChild();
  if (!child) return;
  await waitForExit(child, "backend");
}

async function copyDir(src, dest) {
  await fsp.mkdir(dest, { recursive: true });
  await fsp.cp(src, dest, { recursive: true });
}

function linuxMpvWrapperContent() {
  return [
    "#!/bin/sh",
    'HERE=$(CDPATH= cd "$(dirname "$0")" && pwd -P)',
    'LIB="$HERE/lib"',
    'MPV_LIBRARY_PATH="$LIB${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"',
    'exec "$LIB/ld-linux-x86-64.so.2" --library-path "$MPV_LIBRARY_PATH" "$HERE/bin/mpv-bin" "$@"',
    "",
  ].join("\n");
}

async function writeLinuxMpvWrapper(baseDir) {
  const bundledMpv = path.join(baseDir, "bin", "mpv-bin");
  const bundledLoader = path.join(baseDir, "lib", "ld-linux-x86-64.so.2");
  if (!(await exists(bundledMpv)) || !(await exists(bundledLoader))) return false;

  const wrapperPath = path.join(baseDir, "mpv");
  await fsp.writeFile(wrapperPath, linuxMpvWrapperContent());
  await fsp.chmod(wrapperPath, 0o755);
  return true;
}

async function syncBundledMpvToInternal(choice) {
  if (!(await isBundledMpvReady(choice))) return false;
  await fsp.mkdir(INTERNAL_BIN_DIR, { recursive: true });
  await fsp.rm(internalMpvDir(), { recursive: true, force: true });
  await copyDir(binMpvDir(choice), internalMpvDir());
  if (choice.goos === "linux") {
    await writeLinuxMpvWrapper(internalMpvDir());
  }
  if (choice.goos !== "windows") {
    await fsp.chmod(internalMpvPath(choice), 0o755).catch(() => {});
  }
  return true;
}

async function buildBackendRelease(choice, outDir) {
  if (choice.goos === "windows" && !process.env.CC) {
    const hasMingw = await commandExists("x86_64-w64-mingw32-gcc");
    if (hasMingw) {
      process.env.CC = "x86_64-w64-mingw32-gcc";
    } else {
      throw new Error(
        "windows 构建需要 MinGW 工具链，请设置 CC 或安装 x86_64-w64-mingw32-gcc",
      );
    }
  }

  const binName = choice.goos === "windows" ? "javboss.exe" : "javboss";
  const binPath = path.join(outDir, binName);
  const env = {
    ...process.env,
    GOOS: choice.goos,
    GOARCH: choice.goarch,
    CGO_ENABLED: "1",
  };
  console.log(`[release] 构建后端 (${choice.goos}/${choice.goarch})`);
  await runCommand(
    "go",
    [
      "build",
      "-ldflags",
      "-s -w -X main.buildMode=release",
      "-o",
      binPath,
      "./cmd/server",
    ],
    { cwd: ROOT_DIR, env },
  );
}

async function copyBundledFfprobe(choice, outDir) {
  const srcFfprobe = binFfprobePath(choice);
  const destDir = path.join(outDir, "internal", "bin");
  const destFfprobe = path.join(destDir, ffprobeBinName(choice.goos));

  await fsp.mkdir(destDir, { recursive: true });
  await fsp.copyFile(srcFfprobe, destFfprobe);
  if (choice.goos !== "windows") {
    await fsp.chmod(destFfprobe, 0o755);
  }
}

async function copyBundledFfmpeg(choice, outDir) {
  const srcFfmpeg = binFfmpegPath(choice);
  const destDir = path.join(outDir, "internal", "bin");
  const destFfmpeg = path.join(destDir, ffmpegBinName(choice.goos));

  await fsp.mkdir(destDir, { recursive: true });
  await fsp.copyFile(srcFfmpeg, destFfmpeg);
  if (choice.goos !== "windows") {
    await fsp.chmod(destFfmpeg, 0o755);
  }
}

async function copyBundledMpv(choice, outDir) {
  const destDir = path.join(outDir, "internal", "bin", "mpv");
  await copyDir(binMpvDir(choice), destDir);
  if (choice.goos === "linux") {
    await writeLinuxMpvWrapper(destDir);
  }
  if (choice.goos !== "windows") {
    await fsp.chmod(mpvExecutablePath(destDir, choice), 0o755).catch(() => {});
  }
}

async function copyModernZAssets(outDir) {
  await copyDir(path.join(ROOT_DIR, "modernz"), path.join(outDir, "modernz"));
}

async function createMacCommandLauncher(outDir) {
  const launcherPath = path.join(outDir, "javboss.command");
  const launcherContent = [
    "#!/bin/bash",
    "set -u",
    'QUARANTINE_ATTR="com.apple.quarantine"',
    'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"',
    'cd "$SCRIPT_DIR" || exit 1',
    "",
    'if command -v xattr >/dev/null 2>&1; then',
    '  xattr -dr "$QUARANTINE_ATTR" "$SCRIPT_DIR" >/dev/null 2>&1 || true',
    "fi",
    "",
    '"$SCRIPT_DIR/javboss" "$@"',
    "status=$?",
    'if [ "$status" -ne 0 ]; then',
    '  echo',
    '  echo "JavBoss exited with status $status."',
    '  read -r -p "Press Enter to close..." _',
    "fi",
    'exit "$status"',
    "",
  ].join("\n");

  await fsp.writeFile(launcherPath, launcherContent);
  await fsp.chmod(launcherPath, 0o755);
}

async function createReleaseConfig(outDir) {
  const configPath = path.join(outDir, "config.toml");
  const configContent = [
    "# JavBoss release config",
    "# This file uses TOML format.",
    "# The default browser URL is http://localhost:8655.",
    "# Set server_url to run as a client connected to another JavBoss server.",
    "# You can override server_url at startup with --server-url <URL>.",
    "# Leave server_url empty to run in server mode.",
    "# You can override port at startup with --port <PORT>.",
    'server_url = ""',
    "port = 8655",
    "",
  ].join("\n");
  await fsp.writeFile(configPath, configContent);
}

async function createZip(outDir, zipPath) {
  const hasZip = await commandExists("zip");
  if (!hasZip) {
    throw new Error("需要 zip 命令，请先安装 zip");
  }
  const baseDir = path.dirname(outDir);
  const baseName = path.basename(outDir);
  await runCommand("zip", ["-rq", zipPath, baseName], { cwd: baseDir });
}

async function runRelease(choice, version) {
  const ffprobeOk = await isBundledFfprobeReady(choice);
  if (!ffprobeOk) {
    console.error(
      `[release] bin/${choice.label} 缺少或版本不匹配 ffprobe，请先选择 “download-dependencies” 下载。`,
    );
    process.exitCode = 1;
    return;
  }
  const ffmpegOk = choice.goos !== "darwin" || (await isBundledFfmpegReady(choice));
  if (!ffmpegOk) {
    console.error(
      `[release] bin/${choice.label} 缺少 ffmpeg，请先选择 “download-dependencies” 下载。`,
    );
    process.exitCode = 1;
    return;
  }
  const bundledMpvOk = await isBundledMpvReady(choice);
  const requireBundledMpv = true;
  if (requireBundledMpv && !bundledMpvOk) {
    console.error(
      `[release] bin/${choice.label} 缺少 mpv，请先选择 “download-dependencies” 下载。`,
    );
    process.exitCode = 1;
    return;
  }

  const outDir = path.join(ROOT_DIR, "release", `javboss-${version}-${choice.label}`);
  await fsp.rm(outDir, { recursive: true, force: true });
  await fsp.mkdir(outDir, { recursive: true });

  await buildWeb();
  console.log("[release] 复制前端资源");
  await copyDir(path.join(WEB_DIR, "dist"), path.join(outDir, "web", "dist"));
  await buildBackendRelease(choice, outDir);
  console.log("[release] 复制 ffprobe");
  await copyBundledFfprobe(choice, outDir);
  if (choice.goos === "darwin") {
    console.log("[release] 复制 ffmpeg");
    await copyBundledFfmpeg(choice, outDir);
  }
  if (bundledMpvOk) {
    console.log("[release] 复制 mpv");
    await copyBundledMpv(choice, outDir);
  }
  console.log("[release] 复制 ModernZ OSC");
  await copyModernZAssets(outDir);
  console.log("[release] 生成默认配置文件");
  await createReleaseConfig(outDir);
  if (choice.goos === "darwin") {
    console.log("[release] 生成 macOS .command 启动器");
    await createMacCommandLauncher(outDir);
  }

  const zipPath = path.join(
    ROOT_DIR,
    "release",
    `javboss-${version}-${choice.label}.zip`,
  );
  console.log("[release] 打包 zip");
  await createZip(outDir, zipPath);
  console.log(`[release] 完成：${zipPath}`);
}

async function runBrowserExtensionRelease() {
  const sourceDir = path.join(ROOT_DIR, "browser-extension");
  const manifestPath = path.join(sourceDir, "manifest.json");

  if (!(await exists(manifestPath))) {
    throw new Error("[extension release] browser-extension/manifest.json 不存在");
  }
  const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
  const version = String(manifest.version || "").trim();
  if (!/^\d+(?:\.\d+){0,3}$/.test(version)) {
    throw new Error("[extension release] manifest.json 中的版本号无效");
  }

  const releaseName = `javboss-browser-extension-v${version}`;
  const outDir = path.join(ROOT_DIR, "release", releaseName);
  const zipPath = path.join(ROOT_DIR, "release", `${releaseName}.zip`);

  await fsp.rm(outDir, { recursive: true, force: true });
  await fsp.rm(zipPath, { force: true });
  await fsp.mkdir(outDir, { recursive: true });
  console.log(`[extension release] 打包 Chrome 扩展 v${version}`);
  for (const name of [
    "manifest.json",
    "bridge.html",
    "bridge.js",
    "assist-loading.html",
    "assist-loading.css",
    "popup.html",
    "popup.css",
    "popup.js",
    "service-worker.js",
    "README.md",
  ]) {
    await fsp.copyFile(path.join(sourceDir, name), path.join(outDir, name));
  }
  await copyDir(path.join(sourceDir, "content"), path.join(outDir, "content"));
  await copyDir(path.join(sourceDir, "icons"), path.join(outDir, "icons"));
  console.log("[extension release] 生成 zip");
  await createZip(outDir, zipPath);
  console.log(`[extension release] 完成：${zipPath}`);
}

function ffprobeSources(choice) {
  const linked = FF_BINARY_DOWNLOADS.get(choice.label);
  if (!linked?.ffprobe) return [];
  return [
    {
      url: linked.ffprobe,
      sha256: linked.ffprobeDownloadSHA256 || linked.ffprobeSHA256,
    },
  ];
}

function ffmpegSources(choice) {
  const linked = FF_BINARY_DOWNLOADS.get(choice.label);
  if (!linked?.ffmpeg) return [];
  return [
    {
      url: linked.ffmpeg,
      sha256: linked.ffmpegDownloadSHA256 || linked.ffmpegSHA256,
    },
  ];
}

function mpvUrls(choice) {
  const osUpper = choice.goos.toUpperCase();
  const archUpper = choice.goarch.toUpperCase();
  const envArch = process.env[`MPV_URL_${osUpper}_${archUpper}`];
  const envOs = process.env[`MPV_URL_${osUpper}`];
  const envLabel = process.env[`MPV_URL_${choice.label.replace(/-/g, "_").toUpperCase()}`];

  const urls = [];
  if (process.env.MPV_URL) {
    urls.push(process.env.MPV_URL);
  } else if (envLabel) {
    urls.push(envLabel);
  } else if (envArch) {
    urls.push(envArch);
  } else if (envOs) {
    urls.push(envOs);
  } else if (choice.goos === "windows" && choice.goarch === "amd64") {
    urls.push(
      "https://github.com/mpv-player/mpv/releases/download/v0.41.0/mpv-v0.41.0-x86_64-w64-mingw32.zip",
    );
  } else if (choice.goos === "linux" && choice.goarch === "amd64") {
    urls.push(
      "https://github.com/ivan-hc/MPV-appimage/releases/download/continuous/mpv-Media-Player_0.41.0-6-archimage5.0-x86_64.AppImage",
    );
  } else if (choice.goos === "darwin" && choice.goarch === "amd64") {
    urls.push(
      "https://github.com/mpv-player/mpv/releases/download/v0.41.0/mpv-v0.41.0-macos-15-intel.zip",
    );
  } else if (choice.goos === "darwin" && choice.goarch === "arm64") {
    urls.push("https://github.com/mpv-player/mpv/releases/download/v0.41.0/mpv-v0.41.0-macos-14-arm.zip");
  }

  return { urls };
}

async function downloadFile(url, dest) {
  if (await commandExists("curl")) {
    await runCommand(
      "curl",
      ["-L", "--fail", "--retry", "3", "--retry-all-errors", "-o", dest, url],
    );
    return;
  }
  if (await commandExists("wget")) {
    await runCommand("wget", ["--tries=3", "-O", dest, url]);
    return;
  }
  throw new Error("需要 curl 或 wget 下载文件");
}

async function extractGzipFile(archive, destFile) {
  await pipeline(
    fs.createReadStream(archive),
    createGunzip(),
    fs.createWriteStream(destFile),
  );
}

async function extractArchive(archive, destDir) {
  if (archive.endsWith(".zip")) {
    if (!(await commandExists("unzip"))) {
      throw new Error("需要 unzip 解压 zip 文件");
    }
    await runCommand("unzip", ["-q", archive, "-d", destDir]);
    return;
  }
  if (!(await commandExists("tar"))) {
    throw new Error("需要 tar 解压文件");
  }
  await runCommand("tar", ["-xf", archive, "-C", destDir]);
}

async function findFile(dir, filename) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === filename) {
      return fullPath;
    }
    if (entry.isDirectory()) {
      const found = await findFile(fullPath, filename);
      if (found) return found;
    }
  }
  return null;
}

function downloadFilename(url, fallbackName) {
  try {
    const parsed = new URL(url);
    const base = path.basename(parsed.pathname);
    if (base) return base;
  } catch {
    // fall back to provided name
  }
  return fallbackName;
}

async function installBinaryFromUrl({
  url,
  expectedSHA256,
  target,
  binaryName,
  logLabel,
  choice,
  tmpBase,
}) {
  const archive = path.join(tmpBase, `${logLabel}-${downloadFilename(url, "download.bin")}`);
  const extractDir = path.join(tmpBase, `${logLabel}-extract`);

  try {
    await fsp.rm(archive, { force: true });
    await downloadFile(url, archive);
  } catch (err) {
    console.warn(`[${logLabel}] 下载失败，尝试下一个来源`);
    return false;
  }

  if (expectedSHA256) {
    const actualSHA256 = await sha256File(archive);
    if (actualSHA256 !== expectedSHA256) {
      console.warn(`[${logLabel}] SHA-256 校验失败，拒绝安装`);
      return false;
    }
  }

  try {
    if (archive.toLowerCase().endsWith(".gz")) {
      await extractGzipFile(archive, target);
    } else if (!isArchiveName(archive.toLowerCase())) {
      await fsp.copyFile(archive, target);
    } else {
      await fsp.rm(extractDir, { recursive: true, force: true });
      await fsp.mkdir(extractDir, { recursive: true });
      await extractArchive(archive, extractDir);
      const found = await findFile(extractDir, binaryName);
      if (!found) {
        console.warn(`[${logLabel}] 解压后未找到 ${binaryName}`);
        return false;
      }
      await fsp.copyFile(found, target);
    }
  } catch (err) {
    await fsp.rm(target, { force: true });
    console.warn(`[${logLabel}] 解压失败，尝试下一个来源`);
    return false;
  }

  if (choice.goos !== "windows") {
    await fsp.chmod(target, 0o755);
  }
  return true;
}

async function findDirectory(dir, dirname) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name === dirname) {
      return fullPath;
    }
    if (entry.isDirectory()) {
      const found = await findDirectory(fullPath, dirname);
      if (found) return found;
    }
  }
  return null;
}

async function indexLibraryFiles(dir, index = new Map()) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return index;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await indexLibraryFiles(fullPath, index);
      continue;
    }
    if ((entry.isFile() || entry.isSymbolicLink()) && !index.has(entry.name)) {
      index.set(entry.name, fullPath);
    }
  }
  return index;
}

async function readElfNeeded(filePath) {
  const { stdout } = await runCommandCapture("readelf", ["-d", filePath], {
    env: {
      ...process.env,
      LANG: "C",
      LC_ALL: "C",
      LC_MESSAGES: "C",
    },
  });
  return Array.from(stdout.matchAll(/\(NEEDED\)[^\[]*\[([^\]]+)\]/g), (match) => match[1]);
}

async function isLinuxMpvBundleReady(baseDir, choice) {
  const mpvPath = mpvExecutablePath(baseDir, choice);
  const mpvBin = path.join(baseDir, "bin", "mpv-bin");
  const libDir = path.join(baseDir, "lib");
  const loader = path.join(libDir, "ld-linux-x86-64.so.2");
  if (!(await exists(mpvPath)) || !(await exists(mpvBin)) || !(await exists(loader))) {
    return false;
  }

  const current = currentPlatformChoice();
  if (current?.label === choice.label) {
    try {
      await runCommandCapture(mpvPath, ["--version"]);
    } catch {
      return false;
    }
  }

  if (!(await commandExists("readelf"))) {
    return true;
  }

  const queue = [mpvBin, loader];
  const sdl3 = path.join(libDir, "libSDL3.so.0");
  if (await exists(sdl3)) queue.push(sdl3);
  const seen = new Set();

  while (queue.length) {
    const currentFile = queue.shift();
    if (seen.has(currentFile)) continue;
    seen.add(currentFile);

    let neededLibraries;
    try {
      neededLibraries = await readElfNeeded(currentFile);
    } catch {
      return false;
    }

    for (const needed of neededLibraries) {
      const depPath = path.join(libDir, path.basename(needed));
      if (!(await exists(depPath))) {
        return false;
      }
      if (!seen.has(depPath)) queue.push(depPath);
    }
  }

  return true;
}

async function rewriteAbsoluteNeeded(binaryPath, neededPath) {
  if (!path.isAbsolute(neededPath)) return;

  const replacementName = path.basename(neededPath);
  const needle = Buffer.from(`${neededPath}\0`);
  if (Buffer.byteLength(replacementName) + 1 > needle.length) {
    throw new Error(`[mpv] 无法重写绝对依赖路径：${neededPath}`);
  }

  const replacement = Buffer.alloc(needle.length);
  replacement.write(`${replacementName}\0`);
  const content = await fsp.readFile(binaryPath);
  let offset = content.indexOf(needle);
  if (offset < 0) return;
  while (offset >= 0) {
    replacement.copy(content, offset);
    offset = content.indexOf(needle, offset + needle.length);
  }
  await fsp.writeFile(binaryPath, content);
}

async function copyLinuxMpvDependency({ libraryRoot, libraryIndex, destLibDir, needed }) {
  const filename = path.basename(needed);
  const dest = path.join(destLibDir, filename);
  if (await exists(dest)) return dest;

  const direct = path.join(libraryRoot, filename);
  const src = (await exists(direct)) ? direct : libraryIndex.get(filename);
  if (!src) {
    throw new Error(`[mpv] AppImage 内缺少运行库：${needed}`);
  }

  const realSrc = await fsp.realpath(src).catch(() => src);
  await fsp.copyFile(realSrc, dest);
  return dest;
}

async function collectLinuxMpvDependencies({
  queue,
  seen,
  libraryRoot,
  libraryIndex,
  destLibDir,
}) {
  while (queue.length) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);

    const neededLibraries = await readElfNeeded(current);
    for (const needed of neededLibraries) {
      await rewriteAbsoluteNeeded(current, needed);
      const copied = await copyLinuxMpvDependency({
        libraryRoot,
        libraryIndex,
        destLibDir,
        needed,
      });
      if (!seen.has(copied)) queue.push(copied);
    }
  }
}

async function installLinuxMpvFromAppImage(archive, choice, tmpBase) {
  if (!(await commandExists("readelf"))) {
    throw new Error("[mpv] 精简 Linux AppImage 需要 readelf，请先安装 binutils");
  }

  await fsp.chmod(archive, 0o755).catch(() => {});

  const extractDir = path.join(tmpBase, "appimage-extract");
  await fsp.rm(extractDir, { recursive: true, force: true });
  await fsp.mkdir(extractDir, { recursive: true });
  await runCommand(archive, ["--appimage-extract"], { cwd: extractDir });

  const appRoot = path.join(extractDir, "squashfs-root");
  const junestRoot = path.join(appRoot, ".junest");
  const sourceMpv = path.join(junestRoot, "usr", "bin", "mpv");
  const sourceLibDir = path.join(junestRoot, "usr", "lib");
  const sourceLoader = path.join(sourceLibDir, "ld-linux-x86-64.so.2");
  if (!(await exists(sourceMpv)) || !(await exists(sourceLoader))) {
    throw new Error("[mpv] AppImage 结构不符合预期，未找到 .junest/usr/bin/mpv");
  }

  const installDir = path.join(tmpBase, "mpv-slim");
  const installBinDir = path.join(installDir, "bin");
  const installLibDir = path.join(installDir, "lib");
  await fsp.rm(installDir, { recursive: true, force: true });
  await fsp.mkdir(installBinDir, { recursive: true });
  await fsp.mkdir(installLibDir, { recursive: true });

  const bundledMpv = path.join(installBinDir, "mpv-bin");
  const bundledLoader = path.join(installLibDir, "ld-linux-x86-64.so.2");
  await fsp.copyFile(sourceMpv, bundledMpv);
  await fsp.copyFile(sourceLoader, bundledLoader);
  await fsp.chmod(bundledMpv, 0o755);
  await fsp.chmod(bundledLoader, 0o755);

  const libraryIndex = await indexLibraryFiles(sourceLibDir);
  const queue = [bundledMpv, bundledLoader];
  const seen = new Set();
  const extraRuntimeLibs = ["libSDL3.so.0"];

  await collectLinuxMpvDependencies({
    queue,
    seen,
    libraryRoot: sourceLibDir,
    libraryIndex,
    destLibDir: installLibDir,
  });

  for (const needed of extraRuntimeLibs) {
    const copied = await copyLinuxMpvDependency({
      libraryRoot: sourceLibDir,
      libraryIndex,
      destLibDir: installLibDir,
      needed,
    });
    if (!seen.has(copied)) queue.push(copied);
    await collectLinuxMpvDependencies({
      queue,
      seen,
      libraryRoot: sourceLibDir,
      libraryIndex,
      destLibDir: installLibDir,
    });
  }

  await writeLinuxMpvWrapper(installDir);

  await fsp.rm(binMpvDir(choice), { recursive: true, force: true });
  await copyDir(installDir, binMpvDir(choice));
  await fsp.chmod(binMpvPath(choice), 0o755);
}

function isArchiveName(name) {
  return (
    name.endsWith(".zip") ||
    name.endsWith(".tar") ||
    name.endsWith(".tar.gz") ||
    name.endsWith(".tgz") ||
    name.endsWith(".tar.xz")
  );
}

async function findArchives(dir) {
  const result = [];
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await findArchives(fullPath)));
      continue;
    }
    if (entry.isFile() && isArchiveName(entry.name)) {
      result.push(fullPath);
    }
  }
  return result;
}

async function expandNestedArchives(dir, maxDepth = 2) {
  const seen = new Set();
  for (let depth = 0; depth < maxDepth; depth += 1) {
    const archives = await findArchives(dir);
    let extractedAny = false;
    for (const archive of archives) {
      if (seen.has(archive)) continue;
      seen.add(archive);
      try {
        await extractArchive(archive, path.dirname(archive));
        await fsp.rm(archive, { force: true });
        extractedAny = true;
      } catch {
        continue;
      }
    }
    if (!extractedAny) break;
  }
}

async function downloadFfprobe(choice) {
  const ffprobeTarget = binFfprobePath(choice);

  if (await isBundledFfprobeReady(choice)) {
    console.log(`[ffprobe] 已存在：${platformBinDir(choice)}`);
    return;
  }

  const sources = ffprobeSources(choice);
  if (!sources.length) {
    throw new Error(`[ffprobe] 未找到下载地址（${choice.label}）`);
  }

  await fsp.mkdir(platformBinDir(choice), { recursive: true });
  const tmpBase = await fsp.mkdtemp(path.join(os.tmpdir(), "javboss-ffprobe-"));
  try {
    let installed = false;
    for (const source of sources) {
      const { url, sha256 } = source;
      console.log(`[ffprobe] 下载 ${choice.label}：${url}`);
      installed = await installBinaryFromUrl({
        url,
        expectedSHA256: sha256,
        target: ffprobeTarget,
        binaryName: ffprobeBinName(choice.goos),
        logLabel: "ffprobe",
        choice,
        tmpBase,
      });
      if (installed) {
        console.log(`[ffprobe] 安装完成：${platformBinDir(choice)}`);
        break;
      }
    }

    if (!installed) {
      throw new Error(`[ffprobe] 下载失败，请检查脚本内置的 ${choice.label} 下载链接`);
    }

    const current = currentPlatformChoice();
    if (current && current.label === choice.label) {
      await fsp.mkdir(INTERNAL_BIN_DIR, { recursive: true });
      await fsp.copyFile(ffprobeTarget, ffprobePath(choice));
      if (choice.goos !== "windows") {
        await fsp.chmod(ffprobePath(choice), 0o755);
      }
    }
  } finally {
    await fsp.rm(tmpBase, { recursive: true, force: true });
  }
}

async function downloadFfmpeg(choice) {
  const ffmpegTarget = binFfmpegPath(choice);

  if (await isBundledFfmpegReady(choice)) {
    console.log(`[ffmpeg] 已存在：${platformBinDir(choice)}`);
    return;
  }

  const sources = ffmpegSources(choice);
  if (!sources.length) {
    throw new Error(`[ffmpeg] 未找到下载地址（${choice.label}）`);
  }

  await fsp.mkdir(platformBinDir(choice), { recursive: true });
  const tmpBase = await fsp.mkdtemp(path.join(os.tmpdir(), "javboss-ffmpeg-"));
  try {
    let installed = false;
    for (const source of sources) {
      const { url, sha256 } = source;
      console.log(`[ffmpeg] 下载 ${choice.label}：${url}`);
      installed = await installBinaryFromUrl({
        url,
        expectedSHA256: sha256,
        target: ffmpegTarget,
        binaryName: ffmpegBinName(choice.goos),
        logLabel: "ffmpeg",
        choice,
        tmpBase,
      });
      if (installed) {
        console.log(`[ffmpeg] 安装完成：${platformBinDir(choice)}`);
        break;
      }
    }

    if (!installed) {
      throw new Error(`[ffmpeg] 下载失败，请检查脚本内置的 ${choice.label} 下载链接`);
    }

    const current = currentPlatformChoice();
    if (current && current.label === choice.label) {
      await fsp.mkdir(INTERNAL_BIN_DIR, { recursive: true });
      await fsp.copyFile(ffmpegTarget, ffmpegPath(choice));
      if (choice.goos !== "windows") {
        await fsp.chmod(ffmpegPath(choice), 0o755);
      }
    }
  } finally {
    await fsp.rm(tmpBase, { recursive: true, force: true });
  }
}

async function downloadMpv(choice) {
  if (await isBundledMpvReady(choice)) {
    if (choice.goos === "linux") {
      await writeLinuxMpvWrapper(binMpvDir(choice));
      const current = currentPlatformChoice();
      if (current?.label === choice.label) {
        await writeLinuxMpvWrapper(internalMpvDir());
      }
    }
    console.log(`[mpv] 已存在：${binMpvDir(choice)}`);
    return;
  }
  if (await exists(binMpvDir(choice))) {
    console.log(`[mpv] 已存在的 ${choice.label} mpv 不完整，重新下载`);
    await fsp.rm(binMpvDir(choice), { recursive: true, force: true });
  }

  const { urls } = mpvUrls(choice);
  if (!urls.length) {
    console.log(`[mpv] ${choice.label} 未配置默认下载地址，跳过；可通过 MPV_URL 指定`);
    return;
  }

  await fsp.mkdir(platformBinDir(choice), { recursive: true });
  const tmpBase = await fsp.mkdtemp(path.join(os.tmpdir(), "javboss-mpv-"));
  try {
    let installed = false;
    for (const url of urls) {
      console.log(`[mpv] 下载 ${choice.label}：${url}`);
      const archive = path.join(tmpBase, downloadFilename(url, "mpv-download"));
      const extractDir = path.join(tmpBase, "extract");
      await fsp.rm(extractDir, { recursive: true, force: true });
      await fsp.mkdir(extractDir, { recursive: true });

      try {
        await downloadFile(url, archive);
      } catch (err) {
        console.warn("[mpv] 下载失败，尝试下一个来源");
        continue;
      }

      if (archive.toLowerCase().endsWith(".appimage")) {
        try {
          await installLinuxMpvFromAppImage(archive, choice, tmpBase);
        } catch (err) {
          console.warn(err?.message || "[mpv] AppImage 精简失败，尝试下一个来源");
          continue;
        }
      } else {
        try {
          await extractArchive(archive, extractDir);
        } catch (err) {
          console.warn("[mpv] 解压失败，尝试下一个来源");
          continue;
        }

        if (choice.goos === "darwin") {
          let mpvApp = await findDirectory(extractDir, "mpv.app");
          if (!mpvApp) {
            await expandNestedArchives(extractDir);
            mpvApp = await findDirectory(extractDir, "mpv.app");
          }
          if (!mpvApp) {
            console.warn("[mpv] 未找到 mpv.app，尝试下一个来源");
            continue;
          }
          const srcRoot = path.dirname(mpvApp);
          await fsp.rm(binMpvDir(choice), { recursive: true, force: true });
          await copyDir(srcRoot, binMpvDir(choice));
        } else {
          let mpvFound = await findFile(
            extractDir,
            choice.goos === "windows" ? "mpv.exe" : "mpv",
          );
          if (!mpvFound) {
            await expandNestedArchives(extractDir);
            mpvFound = await findFile(
              extractDir,
              choice.goos === "windows" ? "mpv.exe" : "mpv",
            );
          }
          if (!mpvFound) {
            console.warn("[mpv] 未找到可执行文件，尝试下一个来源");
            continue;
          }
          const srcRoot = path.dirname(mpvFound);
          await fsp.rm(binMpvDir(choice), { recursive: true, force: true });
          await copyDir(srcRoot, binMpvDir(choice));
        }
      }

      if (choice.goos !== "windows") {
        await fsp.chmod(binMpvPath(choice), 0o755).catch(() => {});
      }
      if (await isBundledMpvReady(choice)) {
        console.log(`[mpv] 安装完成：${binMpvDir(choice)}`);
        installed = true;
        break;
      }
    }

    if (!installed) {
      throw new Error("[mpv] 下载失败，请检查网络或设置 MPV_URL");
    }

    const current = currentPlatformChoice();
    if (current && current.label === choice.label) {
      await syncBundledMpvToInternal(choice);
    }
  } finally {
    await fsp.rm(tmpBase, { recursive: true, force: true });
  }
}

async function downloadDependencies(choice) {
  await downloadFfprobe(choice);
  if (choice.goos === "darwin") {
    await downloadFfmpeg(choice);
  }
  await downloadMpv(choice);
}

async function handleDev(mode) {
  if (mode === "frontend") {
    await runFrontendDev();
    return;
  }
  if (mode === "backend") {
    await runBackendDev();
    return;
  }
  if (mode === "both") {
    const child = await startBackendDevChild();
    if (!child) return;
    try {
      await runFrontendDev();
    } finally {
      child.kill("SIGTERM");
      await waitForExit(child, "backend").catch(() => {});
    }
    return;
  }

  const { devTarget } = await inquirer.prompt([
    {
      type: "list",
      name: "devTarget",
      message: "选择开发模式",
      choices: [
        { name: "frontend", value: "frontend" },
        { name: "backend", value: "backend" },
      ],
    },
  ]);

  await handleDev(devTarget);
}

async function handleRelease(platformArg, versionArg) {
  let choice = parsePlatformInput(platformArg);
  let version = versionArg;

  if (!choice && platformArg && versionArg) {
    const alternative = parsePlatformInput(versionArg);
    if (alternative) {
      choice = alternative;
      version = platformArg;
    }
  }

  if (!choice) {
    const prompt = await inquirer.prompt([
      {
        type: "list",
        name: "platform",
        message: "选择打包平台",
        choices: PLATFORM_CHOICES.map((p) => ({ name: p.label, value: p.label })),
      },
    ]);
    choice = platformFromLabel(prompt.platform);
  }

  if (!choice) {
    throw new Error("未选择有效平台");
  }

  if (!version) {
    const prompt = await inquirer.prompt([
      {
        type: "input",
        name: "version",
        message: "请输入版本号",
        validate: (val) => (String(val || "").trim() ? true : "版本号不能为空"),
      },
    ]);
    version = String(prompt.version).trim();
  }

  await runRelease(choice, version);
}

async function handleDownload(platformArg) {
  let choice = parsePlatformInput(platformArg);
  if (!choice) {
    const prompt = await inquirer.prompt([
      {
        type: "list",
        name: "platform",
        message: "选择依赖下载平台",
        choices: PLATFORM_CHOICES.map((p) => ({ name: p.label, value: p.label })),
      },
    ]);
    choice = platformFromLabel(prompt.platform);
  }

  if (!choice) {
    throw new Error("未选择有效平台");
  }

  await downloadDependencies(choice);
}

async function handleDocker(action, args = []) {
  if (action === "--help" || action === "-h" || args.includes("--help") || args.includes("-h")) {
    console.log(`用法：scripts/cli.sh docker start [--build-only]
      scripts/cli.sh docker stop
start 构建镜像并后台启动容器；--build-only 仅构建镜像。
容器固定使用 host 网络，直接监听宿主机端口。
容器使用当前用户的 UID/GID，启动前自动创建数据目录。
stop 停止容器，保留容器和数据。
环境变量：
  JAVBOSS_DOCKER_IMAGE     镜像名称（默认 javboss:local）
  JAVBOSS_DOCKER_PORT      宿主机端口（默认 5174）
  JAVBOSS_DOCKER_DATA_DIR  数据目录（默认仓库下 docker-data）
  JAVBOSS_DOCKER_UID       容器用户 ID（默认当前用户，必须非 0）
  JAVBOSS_DOCKER_GID       容器组 ID（默认当前用户的主组）`);
    return;
  }
  if (!action) {
    const answer = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: "选择 Docker 操作",
        choices: [
          { name: "start", value: "start" },
          { name: "stop", value: "stop" },
        ],
      },
    ]);
    action = answer.action;
  }
  if (action !== "start" && action !== "stop") {
    throw new Error(`不支持的 Docker 操作：${action}，请使用 start 或 stop`);
  }
  for (const arg of args) {
    if (action !== "start" || arg !== "--build-only") throw new Error(`未知参数：${arg}`);
  }
  if (!(await commandExists("docker"))) {
    throw new Error("[docker] 未找到 Docker，请先安装 Docker 和 Docker Compose 插件");
  }
  try {
    await runCommandCapture("docker", ["compose", "version"], { cwd: ROOT_DIR });
  } catch {
    throw new Error("[docker] Docker Compose 不可用，请安装 Docker Compose 插件");
  }
  try {
    await runCommandCapture("docker", ["info"], { cwd: ROOT_DIR });
  } catch {
    throw new Error("[docker] 无法连接 Docker，请确认 Docker 已启动且当前用户有访问权限");
  }

  const composeArgs = ["compose", "-f", path.join(ROOT_DIR, "compose.local.yaml")];
  if (action === "stop") {
    await runCommand("docker", [...composeArgs, "stop", "javboss"], { cwd: ROOT_DIR });
    console.log("[docker] 容器已停止，数据已保留");
    return;
  }
  const uid = process.env.JAVBOSS_DOCKER_UID || String(process.getuid?.() ?? 1000);
  const gid = process.env.JAVBOSS_DOCKER_GID || String(process.getgid?.() ?? 1000);
  if (!/^\d+$/.test(uid) || Number(uid) < 1 || Number(uid) > 4294967294
      || !/^\d+$/.test(gid) || Number(gid) > 4294967294) {
    throw new Error("[docker] 请使用有效的非 root UID 和 GID；不要以 root 用户启动脚本，或设置 JAVBOSS_DOCKER_UID/JAVBOSS_DOCKER_GID");
  }
  const dataDir = path.resolve(ROOT_DIR, process.env.JAVBOSS_DOCKER_DATA_DIR || "docker-data");
  const dockerOptions = {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      JAVBOSS_DOCKER_UID: uid,
      JAVBOSS_DOCKER_GID: gid,
      JAVBOSS_DOCKER_DATA_DIR: dataDir,
    },
  };
  console.log("[docker] 网络模式：host");
  console.log(`[docker] 容器用户：${uid}:${gid}`);
  console.log("[docker] 构建本地镜像");
  await runCommand("docker", [...composeArgs, "build", "javboss"], dockerOptions);
  if (args.includes("--build-only")) return;

  await fsp.mkdir(dataDir, { recursive: true });
  console.log("[docker] 启动容器");
  await runCommand("docker", [
    ...composeArgs, "up", "--detach", "--no-build", "--pull", "never",
    "--wait", "--wait-timeout", "60", "javboss",
  ], dockerOptions);
  console.log("[docker] 容器已启动，访问地址：");
  console.log(`http://localhost:${process.env.JAVBOSS_DOCKER_PORT || "5174"}`);
  console.log("[docker] 查看日志：docker compose -f compose.local.yaml logs -f");
  console.log("[docker] 停止容器：scripts/cli.sh docker stop");
}

async function main() {
  const [action, arg1, ...rest] = process.argv.slice(2);
  const [arg2] = rest;
  if (action === "docker") {
    await handleDocker(arg1, rest);
    return;
  }
  if (action === "dev") {
    await handleDev(arg1);
    return;
  }
  if (action === "release") {
    await handleRelease(arg1, arg2);
    return;
  }
  if (action === "release-browser-extension") {
    await runBrowserExtensionRelease();
    return;
  }
  if (action === "download-dependencies") {
    await handleDownload(arg1);
    return;
  }

  const { mainAction } = await inquirer.prompt([
    {
      type: "list",
      name: "mainAction",
      message: "请选择操作",
      choices: [
        { name: "dev", value: "dev" },
        { name: "docker", value: "docker" },
        { name: "release", value: "release" },
        { name: "release-browser-extension", value: "release-browser-extension" },
        { name: "download-dependencies", value: "download-dependencies" },
      ],
    },
  ]);

  if (mainAction === "docker") {
    await handleDocker();
    return;
  }
  if (mainAction === "dev") {
    await handleDev();
    return;
  }
  if (mainAction === "release") {
    await handleRelease();
    return;
  }
  if (mainAction === "release-browser-extension") {
    await runBrowserExtensionRelease();
    return;
  }
  if (mainAction === "download-dependencies") {
    await handleDownload();
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
