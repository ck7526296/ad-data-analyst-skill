#!/usr/bin/env node
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const PROTOCOL_VERSION = "2025-11-25";
const DEFAULT_REMOTE_URL = "https://emi.qiongzhoukj.cn/qz/mcp";
const DEFAULT_CREDENTIAL_DIR = join(homedir(), ".codex", "ad-data-analyst");
const DEFAULT_CREDENTIAL_FILE = join(DEFAULT_CREDENTIAL_DIR, "credentials.json");
const DEFAULT_KEY_FILE = join(DEFAULT_CREDENTIAL_DIR, "credential.key");
const AUTH_TOOL_NAMES = new Set(["get_ad_auth_status", "login_ad_user", "logout_ad_user"]);

const REMOTE_URL = process.env.AD_DATA_REMOTE_MCP_URL || DEFAULT_REMOTE_URL;
const REMOTE_BEARER_TOKEN = process.env.AD_DATA_REMOTE_MCP_TOKEN || process.env.MCP_AUTH_TOKEN || "";
const CREDENTIAL_FILE = process.env.AD_DATA_CREDENTIAL_FILE || DEFAULT_CREDENTIAL_FILE;
const KEY_FILE = process.env.AD_DATA_CREDENTIAL_KEY_FILE || DEFAULT_KEY_FILE;
const REQUEST_TIMEOUT_MS = readPositiveInt(process.env.AD_DATA_MCP_TIMEOUT_MS, 30000);

let remoteToolsCache;
let transport;
let remote;
let credentials;

function main() {
  remote = createRemoteClient();
  credentials = createCredentialStore();
  transport = new StdioJsonRpcTransport(process.stdin, process.stdout);
  transport.onMessage = (message) => {
    void handleMessage(message).catch((error) => {
      if (message && typeof message === "object" && "id" in message) {
        transport.send(errorResponse(message.id, -32603, sanitizeErrorMessage(error)));
      }
    });
  };
  transport.start();
}

function createRemoteClient() {
  return new RemoteMcpClient({
    url: REMOTE_URL,
    bearerToken: REMOTE_BEARER_TOKEN,
    timeoutMs: REQUEST_TIMEOUT_MS
  });
}

function createCredentialStore() {
  return new FileCredentialStore({
    credentialFile: CREDENTIAL_FILE,
    keyFile: KEY_FILE,
    envKey: process.env.AD_DATA_CREDENTIAL_KEY
  });
}

async function handleMessage(message) {
  if (!message || typeof message !== "object") {
    return;
  }
  if (!("id" in message)) {
    return;
  }

  switch (message.method) {
    case "initialize":
      transport.send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: "ad-data-local-mcp",
            version: "0.1.0"
          },
          instructions: "本机广告数据 MCP 代理：本地加密保存登录凭据，并转发只读分析工具到远程广告数据 MCP。"
        }
      });
      return;
    case "ping":
      transport.send({ jsonrpc: "2.0", id: message.id, result: {} });
      return;
    case "tools/list":
      transport.send({ jsonrpc: "2.0", id: message.id, result: await listTools() });
      return;
    case "tools/call":
      transport.send({ jsonrpc: "2.0", id: message.id, result: await callTool(message.params || {}) });
      return;
    default:
      transport.send(errorResponse(message.id, -32601, `Unsupported method: ${String(message.method)}`));
  }
}

async function listTools() {
  const remoteTools = await getRemoteTools();
  return {
    tools: remoteTools.map((tool) => {
      if (tool.name !== "login_ad_user") {
        return tool;
      }
      return {
        ...tool,
        description: `${tool.description || "Log in to the RuoYi ad backend."} Local proxy stores successful credentials in an encrypted user-local file unless remember=false.`,
        inputSchema: addRememberProperty(tool.inputSchema)
      };
    })
  };
}

async function getRemoteTools() {
  if (!remoteToolsCache) {
    const result = await remote.request("tools/list", {});
    remoteToolsCache = Array.isArray(result?.tools) ? result.tools : [];
  }
  return remoteToolsCache;
}

async function callTool(params) {
  return callToolWithDependenciesInternal(params, remote, credentials);
}

function createToolCaller(options = {}) {
  const remoteClient = options.remote || remote;
  const credentialStore = options.credentials || credentials;
  return async function callToolWithDependencies(params) {
    return callToolWithDependenciesInternal(params, remoteClient, credentialStore);
  };
}

async function callToolWithDependenciesInternal(params, remoteClient, credentialStore) {
  const name = typeof params.name === "string" ? params.name : "";
  const args = isRecord(params.arguments) ? params.arguments : {};
  if (!name) {
    return toolError("INVALID_ARGUMENT", "tool name is required");
  }

  if (name === "login_ad_user") {
    return loginWithOptionalRememberUsing(remoteClient, credentialStore, args);
  }
  if (name === "logout_ad_user") {
    let result;
    let remoteLogoutError;
    try {
      result = await remoteClient.callTool("logout_ad_user", args);
    } catch (error) {
      remoteLogoutError = sanitizeErrorMessage(error);
    } finally {
      await credentialStore.delete();
    }
    if (remoteLogoutError) {
      return toolError("REMOTE_LOGOUT_FAILED", "本地保存的广告后台账号密码已删除，但远程 MCP 当前登录态清除失败；重启 Codex 或远程会话过期后会失效。", {
        localCredentialsDeleted: true,
        remoteMessage: remoteLogoutError
      });
    }
    return result;
  }
  if (name === "get_ad_auth_status") {
    const status = await remoteClient.callTool("get_ad_auth_status", args);
    if (!toolResultHasErrorCode(status, "AUTH_REQUIRED") && isAuthenticatedStatus(status)) {
      return status;
    }
    const restored = await loginFromSavedCredentialsUsing(remoteClient, credentialStore);
    return restored || status;
  }

  const firstResult = await remoteClient.callTool(name, args);
  if (!toolResultHasErrorCode(firstResult, "AUTH_REQUIRED")) {
    return firstResult;
  }
  const restored = await loginFromSavedCredentialsUsing(remoteClient, credentialStore);
  if (!restored) {
    return firstResult;
  }
  if (toolResultHasAnyError(restored)) {
    return restored;
  }
  return remoteClient.callTool(name, args);
}

async function loginWithOptionalRememberUsing(remoteClient, credentialStore, args) {
  const remember = args.remember !== false;
  const remoteArgs = { ...args };
  delete remoteArgs.remember;

  const result = await remoteClient.callTool("login_ad_user", remoteArgs);
  if (toolResultHasAnyError(result)) {
    return result;
  }

  if (remember) {
    const username = typeof remoteArgs.username === "string" ? remoteArgs.username : "";
    const password = typeof remoteArgs.password === "string" ? remoteArgs.password : "";
    if (username && password) {
      await credentialStore.save({ username, password });
    }
  }
  return result;
}

async function loginFromSavedCredentialsUsing(remoteClient, credentialStore) {
  const saved = await credentialStore.load();
  if (!saved) {
    return undefined;
  }
  const result = await remoteClient.callTool("login_ad_user", {
    username: saved.username,
    password: saved.password
  });
  if (toolResultHasAnyError(result)) {
    await credentialStore.delete();
    return toolError("AUTH_REQUIRED", "本地保存的广告后台账号密码已失效，请重新提供账号密码。");
  }
  return result;
}

function isAuthenticatedStatus(result) {
  const payload = parseToolJson(result);
  return payload?.authenticated === true;
}

function toolResultHasAnyError(result) {
  const payload = parseToolJson(result);
  return typeof payload?.errorCode === "string";
}

function toolResultHasErrorCode(result, code) {
  const payload = parseToolJson(result);
  return payload?.errorCode === code;
}

function parseToolJson(result) {
  const content = Array.isArray(result?.content) ? result.content : [];
  const text = content.find((item) => item?.type === "text" && typeof item.text === "string")?.text;
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function toolError(errorCode, message, details) {
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        errorCode,
        message,
        ...(details ? { details } : {})
      })
    }]
  };
}

function addRememberProperty(inputSchema) {
  const schema = inputSchema && typeof inputSchema === "object"
    ? JSON.parse(JSON.stringify(inputSchema))
    : { type: "object", properties: {}, required: [] };
  schema.type ||= "object";
  schema.properties ||= {};
  schema.properties.remember = {
    type: "boolean",
    description: "Whether to save successful credentials in the encrypted local file. Defaults to true."
  };
  return schema;
}

class RemoteMcpClient {
  constructor(options) {
    this.url = options.url;
    this.bearerToken = options.bearerToken;
    this.timeoutMs = options.timeoutMs;
    this.nextId = 1;
    this.sessionId = undefined;
    this.initialized = false;
    this.initializingPromise = undefined;
  }

  async ensureInitialized() {
    if (this.initialized) {
      return;
    }
    if (!this.initializingPromise) {
      this.initializingPromise = this.initializeRemote();
    }
    await this.initializingPromise;
  }

  async initializeRemote() {
    try {
      await this.request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: "ad-data-local-mcp",
          version: "0.1.0"
        }
      });
      await this.notify("notifications/initialized", {});
      this.initialized = true;
    } finally {
      this.initializingPromise = undefined;
    }
  }

  async callTool(name, args) {
    await this.ensureInitialized();
    return this.request("tools/call", {
      name,
      arguments: args || {}
    });
  }

  async request(method, params) {
    if (method !== "initialize") {
      await this.ensureInitialized();
    }
    const id = this.nextId++;
    const response = await this.post({
      jsonrpc: "2.0",
      id,
      method,
      params
    });
    if (response.error) {
      throw new Error(response.error.message || `Remote MCP request failed: ${method}`);
    }
    return response.result;
  }

  async notify(method, params) {
    await this.post({
      jsonrpc: "2.0",
      method,
      params
    });
  }

  async post(body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers = {
        "content-type": "application/json",
        accept: "application/json, text/event-stream"
      };
      if (this.bearerToken) {
        headers.authorization = `Bearer ${this.bearerToken}`;
      }
      if (this.sessionId) {
        headers["mcp-session-id"] = this.sessionId;
      }

      const response = await fetch(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const sessionId = response.headers.get("mcp-session-id");
      if (sessionId) {
        this.sessionId = sessionId;
      }
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Remote MCP HTTP ${response.status}: ${sanitizeRemoteText(text)}`);
      }
      if (response.status === 202) {
        return {};
      }
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("text/event-stream")) {
        return await readSseJsonRpcResponse(response);
      }
      if (contentType.includes("application/json")) {
        const payload = await response.json();
        return Array.isArray(payload) ? payload[0] : payload;
      }
      const text = await response.text().catch(() => "");
      throw new Error(`Remote MCP returned unsupported content type: ${contentType || "unknown"} ${sanitizeRemoteText(text)}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

async function readSseJsonRpcResponse(response) {
  const text = await response.text();
  const events = text.split(/\r?\n\r?\n/);
  for (const event of events) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) {
      continue;
    }
    const message = JSON.parse(data);
    if ("id" in message || "result" in message || "error" in message) {
      return message;
    }
  }
  return {};
}

class FileCredentialStore {
  constructor(options) {
    this.credentialFile = options.credentialFile;
    this.keyFile = options.keyFile;
    this.envKey = options.envKey;
  }

  async save(value) {
    const key = await this.getKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const plaintext = Buffer.from(JSON.stringify(value), "utf8");
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const payload = {
      version: 1,
      algorithm: "AES-256-GCM",
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
      data: encrypted.toString("base64"),
      updatedAt: new Date().toISOString()
    };
    await ensurePrivateDir(dirname(this.credentialFile));
    await writeFilePrivate(this.credentialFile, `${JSON.stringify(payload, null, 2)}\n`);
  }

  async load() {
    let raw;
    try {
      raw = await readFile(this.credentialFile, "utf8");
      await chmod(this.credentialFile, 0o600).catch(() => undefined);
    } catch (error) {
      if (error?.code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
    try {
      const payload = JSON.parse(raw);
      if (payload?.version !== 1 || payload?.algorithm !== "AES-256-GCM") {
        return undefined;
      }
      const key = await this.getKey();
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
      decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(payload.data, "base64")),
        decipher.final()
      ]);
      const value = JSON.parse(decrypted.toString("utf8"));
      if (typeof value.username !== "string" || typeof value.password !== "string") {
        return undefined;
      }
      return {
        username: value.username,
        password: value.password
      };
    } catch {
      await this.delete();
      return undefined;
    }
  }

  async delete() {
    await rm(this.credentialFile, { force: true });
  }

  async getKey() {
    if (this.envKey) {
      return normalizeKey(this.envKey);
    }
    try {
      const existing = (await readFile(this.keyFile, "utf8")).trim();
      const key = normalizeKey(existing);
      await chmod(this.keyFile, 0o600).catch(() => undefined);
      return key;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        await rm(this.keyFile, { force: true }).catch(() => undefined);
      }
    }
    await ensurePrivateDir(dirname(this.keyFile));
    const key = randomBytes(32).toString("base64");
    await writeFilePrivate(this.keyFile, `${key}\n`);
    return Buffer.from(key, "base64");
  }
}

function normalizeKey(value) {
  const trimmed = value.trim();
  const decoded = Buffer.from(trimmed, "base64");
  if (decoded.length === 32) {
    return decoded;
  }
  const hex = Buffer.from(trimmed, "hex");
  if (hex.length === 32) {
    return hex;
  }
  if (Buffer.byteLength(trimmed, "utf8") === 32) {
    return Buffer.from(trimmed, "utf8");
  }
  throw new Error("AD_DATA_CREDENTIAL_KEY must be 32 bytes as base64, hex, or utf8");
}

async function ensurePrivateDir(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700).catch(() => undefined);
}

async function writeFilePrivate(path, content) {
  await writeFile(path, content, { mode: 0o600 });
  await chmod(path, 0o600).catch(() => undefined);
}

class StdioJsonRpcTransport {
  constructor(stdin, stdout) {
    this.stdin = stdin;
    this.stdout = stdout;
    this.buffer = "";
    this.onMessage = undefined;
  }

  start() {
    this.stdin.setEncoding("utf8");
    this.stdin.on("data", (chunk) => {
      this.buffer += chunk;
      let index;
      while ((index = this.buffer.indexOf("\n")) !== -1) {
        const line = this.buffer.slice(0, index).replace(/\r$/, "");
        this.buffer = this.buffer.slice(index + 1);
        if (!line.trim()) {
          continue;
        }
        try {
          this.onMessage?.(JSON.parse(line));
        } catch {
          this.send(errorResponse(null, -32700, "Parse error"));
        }
      }
    });
  }

  send(message) {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }
}

function errorResponse(id, code, message) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message
    }
  };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readPositiveInt(value, fallback) {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sanitizeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return sanitizeRemoteText(message);
}

function sanitizeRemoteText(text) {
  return String(text)
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[REDACTED]")
    .replace(/(Authorization\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/(token\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/(password\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]");
}

export {
  FileCredentialStore,
  RemoteMcpClient,
  addRememberProperty,
  createToolCaller,
  parseToolJson,
  toolResultHasAnyError,
  toolResultHasErrorCode
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
