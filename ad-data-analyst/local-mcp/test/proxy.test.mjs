import assert from "node:assert/strict";
import test from "node:test";
import { RemoteMcpClient, createToolCaller, parseToolJson } from "../dist/server.js";

test("login_ad_user saves credentials after successful remote login", async () => {
  const remote = new FakeRemote({
    login_ad_user: ok({ authenticated: true })
  });
  const credentials = new MemoryCredentials();
  const callTool = createToolCaller({ remote, credentials });

  const result = await callTool({
    name: "login_ad_user",
    arguments: {
      username: "alice",
      password: "pass-one"
    }
  });

  assert.equal(parseToolJson(result).authenticated, true);
  assert.deepEqual(credentials.saved, {
    username: "alice",
    password: "pass-one"
  });
  assert.deepEqual(remote.calls[0], {
    name: "login_ad_user",
    args: {
      username: "alice",
      password: "pass-one"
    }
  });
});

test("login_ad_user respects remember=false", async () => {
  const remote = new FakeRemote({
    login_ad_user: ok({ authenticated: true })
  });
  const credentials = new MemoryCredentials();
  const callTool = createToolCaller({ remote, credentials });

  await callTool({
    name: "login_ad_user",
    arguments: {
      username: "alice",
      password: "pass-one",
      remember: false
    }
  });

  assert.equal(credentials.saved, undefined);
  assert.equal("remember" in remote.calls[0].args, false);
});

test("business tool AUTH_REQUIRED triggers saved login and retries once", async () => {
  const remote = new FakeRemote({
    search_ad_plans: [
      error("AUTH_REQUIRED", "请先登录"),
      ok({ rows: [{ planId: 1 }] })
    ],
    login_ad_user: ok({ authenticated: true })
  });
  const credentials = new MemoryCredentials({
    username: "alice",
    password: "pass-one"
  });
  const callTool = createToolCaller({ remote, credentials });

  const result = await callTool({
    name: "search_ad_plans",
    arguments: {
      planName: "测试计划"
    }
  });

  assert.deepEqual(parseToolJson(result), { rows: [{ planId: 1 }] });
  assert.deepEqual(remote.calls.map((call) => call.name), [
    "search_ad_plans",
    "login_ad_user",
    "search_ad_plans"
  ]);
});

test("invalid saved credentials are deleted and return AUTH_REQUIRED", async () => {
  const remote = new FakeRemote({
    search_ad_plans: error("AUTH_REQUIRED", "请先登录"),
    login_ad_user: error("AUTH_FAILED", "用户名或密码错误")
  });
  const credentials = new MemoryCredentials({
    username: "alice",
    password: "bad-pass"
  });
  const callTool = createToolCaller({ remote, credentials });

  const result = await callTool({
    name: "search_ad_plans",
    arguments: {
      planName: "测试计划"
    }
  });

  assert.equal(parseToolJson(result).errorCode, "AUTH_REQUIRED");
  assert.equal(credentials.deleted, true);
});

test("get_ad_auth_status auto logs in when remote is unauthenticated", async () => {
  const remote = new FakeRemote({
    get_ad_auth_status: ok({ authenticated: false }),
    login_ad_user: ok({ authenticated: true, username: "a***e" })
  });
  const credentials = new MemoryCredentials({
    username: "alice",
    password: "pass-one"
  });
  const callTool = createToolCaller({ remote, credentials });

  const result = await callTool({
    name: "get_ad_auth_status",
    arguments: {}
  });

  assert.equal(parseToolJson(result).authenticated, true);
  assert.deepEqual(remote.calls.map((call) => call.name), [
    "get_ad_auth_status",
    "login_ad_user"
  ]);
});

test("logout_ad_user clears local credentials", async () => {
  const remote = new FakeRemote({
    logout_ad_user: ok({ authenticated: false })
  });
  const credentials = new MemoryCredentials({
    username: "alice",
    password: "pass-one"
  });
  const callTool = createToolCaller({ remote, credentials });

  await callTool({
    name: "logout_ad_user",
    arguments: {}
  });

  assert.equal(credentials.deleted, true);
});

test("logout_ad_user clears local credentials when remote logout fails", async () => {
  const remote = new FakeRemote({
    logout_ad_user: new Error("remote unavailable")
  });
  const credentials = new MemoryCredentials({
    username: "alice",
    password: "pass-one"
  });
  const callTool = createToolCaller({ remote, credentials });

  const result = await callTool({
    name: "logout_ad_user",
    arguments: {}
  });

  assert.equal(credentials.deleted, true);
  assert.equal(parseToolJson(result).errorCode, "REMOTE_LOGOUT_FAILED");
  assert.equal(parseToolJson(result).details.localCredentialsDeleted, true);
});

test("RemoteMcpClient serializes concurrent initialization", async () => {
  const client = new RemoteMcpClient({
    url: "https://example.test/mcp",
    bearerToken: "",
    timeoutMs: 1000
  });
  const requests = [];
  client.post = async (body) => {
    requests.push(body.method);
    if (body.method === "initialize") {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { result: {} };
    }
    return {};
  };

  await Promise.all([
    client.ensureInitialized(),
    client.ensureInitialized(),
    client.ensureInitialized()
  ]);

  assert.deepEqual(requests, [
    "initialize",
    "notifications/initialized"
  ]);
});

class FakeRemote {
  constructor(responses) {
    this.responses = responses;
    this.calls = [];
  }

  async callTool(name, args) {
    this.calls.push({ name, args });
    const configured = this.responses[name];
    if (Array.isArray(configured)) {
      return configured.shift();
    }
    if (configured instanceof Error) {
      throw configured;
    }
    return configured;
  }
}

class MemoryCredentials {
  constructor(initial) {
    this.current = initial;
    this.saved = undefined;
    this.deleted = false;
  }

  async save(value) {
    this.current = value;
    this.saved = value;
  }

  async load() {
    return this.current;
  }

  async delete() {
    this.current = undefined;
    this.deleted = true;
  }
}

function ok(payload) {
  return {
    content: [{
      type: "text",
      text: JSON.stringify(payload)
    }]
  };
}

function error(errorCode, message) {
  return ok({ errorCode, message });
}
