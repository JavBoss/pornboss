import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cli = fileURLToPath(new URL("../cli.mjs", import.meta.url));
const root = path.resolve(path.dirname(cli), "../..");

function invoke(t, args, fail = "", port = "5174") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "javboss-docker-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const log = path.join(dir, "calls.jsonl");
  fs.writeFileSync(path.join(dir, "docker"), `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.DOCKER_TEST_LOG, JSON.stringify({ args, cwd: process.cwd() }) + "\\n");
if (process.env.DOCKER_TEST_FAIL && args.includes(process.env.DOCKER_TEST_FAIL)) process.exit(1);
`, { mode: 0o755 });
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: dir,
    env: {
      ...process.env,
      PATH: `${dir}${path.delimiter}${process.env.PATH}`,
      DOCKER_TEST_LOG: log,
      DOCKER_TEST_FAIL: fail,
      JAVBOSS_DOCKER_PORT: port,
    },
    encoding: "utf8",
  });
  const calls = fs.existsSync(log)
    ? fs.readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line))
    : [];
  return { ...result, calls };
}

test("docker start builds before starting, using the repository from any cwd", (t) => {
  const result = invoke(t, ["docker", "start"]);
  assert.equal(result.status, 0, result.stderr);
  const compose = ["compose", "-f", path.join(root, "compose.local.yaml")];
  assert.deepEqual(result.calls.map((call) => call.args), [
    ["compose", "version"],
    ["info"],
    [...compose, "build", "javboss"],
    [...compose, "up", "--detach", "--no-build", "--pull", "never",
      "--wait", "--wait-timeout", "60", "javboss"],
  ]);
  assert.ok(result.calls.every((call) => call.cwd === root));
  assert.match(result.stdout, /http:\/\/localhost:5174/);
});

test("build-only does not start a container", (t) => {
  const result = invoke(t, ["docker", "start", "--build-only"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls.length, 3);
  assert.ok(result.calls.at(-1).args.includes("build"));
});

test("docker stop stops the service without rebuilding or removing data", (t) => {
  const result = invoke(t, ["docker", "stop"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls.map((call) => call.args), [
    ["compose", "version"],
    ["info"],
    ["compose", "-f", path.join(root, "compose.local.yaml"), "stop", "javboss"],
  ]);
  assert.ok(result.calls.every((call) => call.cwd === root));
});

test("Docker stop failure is reported", (t) => {
  const result = invoke(t, ["docker", "stop"], "stop");
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout, /容器已停止/);
});

for (const failure of ["version", "info", "build", "up"]) {
  test(`Docker ${failure} failure stops the workflow`, (t) => {
    const result = invoke(t, ["docker", "start"], failure);
    assert.equal(result.status, 1);
    assert.ok(result.calls.at(-1).args.includes(failure));
    assert.doesNotMatch(result.stdout, /容器已启动/);
  });
}

test("invalid arguments fail without invoking Docker", (t) => {
  for (const args of [["docker", "unknown"], ["docker", "start", "--unknown"], ["docker", "stop", "--build-only"]]) {
    const result = invoke(t, args);
    assert.equal(result.status, 1);
    assert.equal(result.calls.length, 0);
  }
});

test("Docker help works without invoking Docker", (t) => {
  const result = invoke(t, ["docker", "--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--build-only/);
  assert.equal(result.calls.length, 0);
});

test("host networking prints the custom listening port without querying published ports", (t) => {
  const result = invoke(t, ["docker", "start"], "", "9123");
  assert.equal(result.status, 0, result.stderr);
  const compose = ["compose", "-f", path.join(root, "compose.local.yaml")];
  assert.deepEqual(result.calls.slice(2).map((call) => call.args), [
    [...compose, "build", "javboss"],
    [...compose, "up", "--detach", "--no-build", "--pull", "never",
      "--wait", "--wait-timeout", "60", "javboss"],
  ]);
  assert.match(result.stdout, /http:\/\/localhost:9123/);
});
