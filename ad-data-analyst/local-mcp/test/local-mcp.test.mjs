import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  FileCredentialStore,
  addRememberProperty,
  parseToolJson,
  toolResultHasAnyError,
  toolResultHasErrorCode
} from "../dist/server.js";

test("FileCredentialStore encrypts credentials and restores them", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ad-data-local-mcp-"));
  const store = new FileCredentialStore({
    credentialFile: join(dir, "credentials.json"),
    keyFile: join(dir, "credential.key")
  });

  await store.save({ username: "alice", password: "pass-one" });

  const raw = await readFile(join(dir, "credentials.json"), "utf8");
  assert.doesNotMatch(raw, /alice|pass-one/);
  assert.match(raw, /AES-256-GCM/);
  assert.deepEqual(await store.load(), {
    username: "alice",
    password: "pass-one"
  });
});

test("FileCredentialStore creates private files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ad-data-local-mcp-"));
  const store = new FileCredentialStore({
    credentialFile: join(dir, "credentials.json"),
    keyFile: join(dir, "credential.key")
  });

  await store.save({ username: "alice", password: "pass-one" });

  const credentialMode = (await stat(join(dir, "credentials.json"))).mode & 0o777;
  const keyMode = (await stat(join(dir, "credential.key"))).mode & 0o777;
  assert.equal(credentialMode, 0o600);
  assert.equal(keyMode, 0o600);
});

test("FileCredentialStore deletes corrupt credential file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ad-data-local-mcp-"));
  const credentialFile = join(dir, "credentials.json");
  const store = new FileCredentialStore({
    credentialFile,
    keyFile: join(dir, "credential.key")
  });

  await writeFile(credentialFile, "{not-json", { mode: 0o600 });

  assert.equal(await store.load(), undefined);
  await assert.rejects(() => stat(credentialFile), /ENOENT/);
});

test("FileCredentialStore delete removes saved credentials", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ad-data-local-mcp-"));
  const store = new FileCredentialStore({
    credentialFile: join(dir, "credentials.json"),
    keyFile: join(dir, "credential.key")
  });

  await store.save({ username: "alice", password: "pass-one" });
  await store.delete();

  assert.equal(await store.load(), undefined);
});

test("FileCredentialStore tightens existing credential and key file permissions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ad-data-local-mcp-"));
  const credentialFile = join(dir, "credentials.json");
  const keyFile = join(dir, "credential.key");
  const store = new FileCredentialStore({ credentialFile, keyFile });

  await store.save({ username: "alice", password: "pass-one" });
  await chmod(credentialFile, 0o644);
  await chmod(keyFile, 0o644);

  assert.deepEqual(await store.load(), {
    username: "alice",
    password: "pass-one"
  });
  assert.equal((await stat(credentialFile)).mode & 0o777, 0o600);
  assert.equal((await stat(keyFile)).mode & 0o777, 0o600);
});

test("FileCredentialStore recreates invalid key file on save", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ad-data-local-mcp-"));
  const keyFile = join(dir, "credential.key");
  const store = new FileCredentialStore({
    credentialFile: join(dir, "credentials.json"),
    keyFile
  });

  await writeFile(keyFile, "bad-key", { mode: 0o600 });
  await store.save({ username: "alice", password: "pass-one" });

  assert.deepEqual(await store.load(), {
    username: "alice",
    password: "pass-one"
  });
});

test("tool result helpers parse error codes", () => {
  const result = {
    content: [{
      type: "text",
      text: JSON.stringify({ errorCode: "AUTH_REQUIRED", message: "login" })
    }]
  };

  assert.deepEqual(parseToolJson(result), {
    errorCode: "AUTH_REQUIRED",
    message: "login"
  });
  assert.equal(toolResultHasAnyError(result), true);
  assert.equal(toolResultHasErrorCode(result, "AUTH_REQUIRED"), true);
  assert.equal(toolResultHasErrorCode(result, "PERMISSION_DENIED"), false);
});

test("login schema gains remember flag without dropping remote fields", () => {
  const schema = addRememberProperty({
    type: "object",
    properties: {
      username: { type: "string" },
      password: { type: "string" }
    },
    required: ["username", "password"]
  });

  assert.equal(schema.properties.username.type, "string");
  assert.equal(schema.properties.password.type, "string");
  assert.equal(schema.properties.remember.type, "boolean");
  assert.deepEqual(schema.required, ["username", "password"]);
});
