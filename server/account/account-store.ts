import { chmod, mkdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { accountKeychain, keychainAccount } from "./account-keychain.ts";

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

type Save = (data: AccountState) => Promise<void>;

export function accountStore(
  dir = process.env.HN_DATA_DIR || join(homedir(), ".local", "share", "hacker-news"),
  keychain = accountKeychain,
) {
  const folder = join(dir, "account");

  async function exclusive<T>(action: (data: AccountState, save: Save) => T | Promise<T>) {
    await mkdir(folder, { recursive: true, mode: 0o700 });
    await chmod(folder, 0o700);
    const location = await realpath(folder);
    const account = keychainAccount(location);
    const options = { stale: 120_000, retries: { retries: 70, maxTimeout: 400, minTimeout: 25 } };
    const unlock = await lockfile.lock(location, { ...options, realpath: false });
    try {
      const saved = await keychain.read(account);
      const data: AccountState = saved
        ? JSON.parse(saved)
        : { profiles: [], active: null, revision: 0 };
      return await action(data, (state) => keychain.write(account, JSON.stringify(state)));
    } finally {
      await unlock();
    }
  }

  return { read: () => exclusive((data) => data), exclusive };
}
