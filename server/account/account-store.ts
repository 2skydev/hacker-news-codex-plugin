import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { credentialEncryption } from "./credential-encryption.ts";

export interface AccountTokens {
  access?: string;
  refresh?: string;
  id?: string;
  expires: number;
  earliest: number;
  scopes: string[];
}

export interface AccountProfile {
  clientId: string;
  subject?: string;
  label?: string;
  tokens?: AccountTokens;
  rotation?: { tokens: AccountTokens; newIdentity: boolean; received: number };
}

export interface AccountState {
  host?: string;
  revision: number;
  profiles: AccountProfile[];
  active: string | null;
}

interface EncryptedAccount {
  version: number;
  provider: string;
  ciphertext: string;
}

interface LegacyCredentials {
  accessToken?: string;
  refreshToken?: string;
  expiresAt: number;
  earliestRefreshAt?: number | string;
}

interface LegacyAccount {
  version: number;
  activeProfileId?: string;
  pendingRegistrations: { clientId: string }[];
  profiles: {
    id: string;
    clientId: string;
    subject?: string;
    label?: string;
    identity?: { email?: string; name?: string };
    credentials?: LegacyCredentials;
    scopes: string[];
    profileIdToken?: string;
    pendingRefresh?: {
      credentials: LegacyCredentials;
      scopes: string[];
      idToken?: string;
      receivedAt: number;
    };
  }[];
}

function sdkAccount(state: LegacyAccount, host?: string): AccountState {
  if (state.version !== 2) throw new Error("저장된 계정 형식을 확인해 주세요.");
  const tokens = (
    credentials: LegacyCredentials,
    scopes: string[],
    id?: string,
  ): AccountTokens => ({
    access: credentials.accessToken,
    refresh: credentials.refreshToken,
    expires: credentials.expiresAt,
    earliest:
      typeof credentials.earliestRefreshAt === "number"
        ? credentials.earliestRefreshAt * 1000
        : Date.parse(credentials.earliestRefreshAt ?? "") || 0,
    scopes,
    ...(id && { id }),
  });
  const profiles = state.profiles.map((profile) => ({
    clientId: profile.clientId,
    subject: profile.subject,
    label: profile.identity?.email || profile.identity?.name || profile.label,
    ...(profile.credentials && {
      tokens: tokens(profile.credentials, profile.scopes, profile.profileIdToken),
    }),
    ...(profile.pendingRefresh && {
      rotation: {
        tokens: tokens(
          profile.pendingRefresh.credentials,
          profile.pendingRefresh.scopes,
          profile.pendingRefresh.idToken,
        ),
        newIdentity: true,
        received: profile.pendingRefresh.receivedAt,
      },
    }),
  }));
  return {
    host,
    revision: 0,
    profiles: [...profiles, ...state.pendingRegistrations.map(({ clientId }) => ({ clientId }))],
    active:
      state.profiles.find((profile) => profile.id === state.activeProfileId)?.clientId ??
      state.pendingRegistrations[0]?.clientId ??
      null,
  };
}

async function jsonFile<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
}

export function accountStore(
  dir = process.env.HN_DATA_DIR || join(homedir(), ".local", "share", "hacker-news"),
  encryption = credentialEncryption,
) {
  const folder = join(dir, "account");
  const path = join(folder, "accounts.json");

  async function unpack<T>(value: EncryptedAccount): Promise<T> {
    if (value.version !== 3 || value.provider !== encryption.id)
      throw new Error("저장된 계정의 암호화 형식을 확인해 주세요.");
    return JSON.parse(await encryption.decrypt(Buffer.from(value.ciphertext, "base64")));
  }

  async function load(): Promise<AccountState> {
    const saved = await jsonFile<EncryptedAccount | AccountState>(path);
    if (saved && "version" in saved && saved.version === 3) return unpack(saved);
    if (saved) {
      const state = saved as AccountState;
      if (state.profiles.length) await write(state);
      return state;
    }
    const host = (await jsonFile<{ id: string }>(join(folder, "chatgpt-host.json")))?.id;
    const sdkPath = join(folder, "chatgpt-auth.json");
    const previous = await jsonFile<EncryptedAccount>(sdkPath);
    if (!previous) return { host, profiles: [], active: null, revision: 0 };
    const converted = sdkAccount(await unpack(previous), host);
    await write(converted);
    await rm(sdkPath);
    return converted;
  }

  async function write(data: AccountState) {
    const temp = join(folder, `${randomUUID()}.tmp`);
    try {
      const record = data.profiles.length
        ? {
            version: 3,
            provider: encryption.id,
            ciphertext: Buffer.from(await encryption.encrypt(JSON.stringify(data))).toString(
              "base64",
            ),
          }
        : data;
      await writeFile(temp, JSON.stringify(record), { mode: 0o600, flag: "wx", flush: true });
      await rename(temp, path);
    } finally {
      await rm(temp, { force: true });
    }
  }

  async function exclusive<T>(action: (data: AccountState, save: typeof write) => T | Promise<T>) {
    await mkdir(folder, { recursive: true, mode: 0o700 });
    await chmod(folder, 0o700);
    const options = { stale: 120_000, retries: { retries: 70, maxTimeout: 400, minTimeout: 25 } };
    const unlockSdk = await lockfile.lock(path, {
      ...options,
      realpath: false,
      lockfilePath: join(folder, ".chatgpt-auth.lock"),
    });
    try {
      const unlock = await lockfile.lock(folder, options);
      try {
        return await action(await load(), write);
      } finally {
        await unlock();
      }
    } finally {
      await unlockSdk();
    }
  }
  return { read: () => exclusive((data) => data), exclusive };
}
