import { execFile } from "node:child_process";
import { createHash } from "node:crypto";

export interface AccountKeychain {
  read(account: string): Promise<string | undefined>;
  write(account: string, state: string): Promise<void>;
}

export const keychainService = "com.2skydev.hacker-news";

export function keychainAccount(folder: string) {
  return `account-state-v1-${createHash("sha256").update(folder).digest("hex")}`;
}

// Pass account data on stdin so tokens stay out of process arguments and files.
const script = `
ObjC.import("Foundation");
ObjC.import("Security");

function run([operation, service, account]) {
  const value = (name) => ObjC.castRefToObject($[name]);
  const query = $.NSMutableDictionary.dictionary;
  query.setObjectForKey(value("kSecClassGenericPassword"), value("kSecClass"));
  query.setObjectForKey($(service), value("kSecAttrService"));
  query.setObjectForKey($(account), value("kSecAttrAccount"));
  const missing = Number($.errSecItemNotFound);

  if (operation === "read") {
    query.setObjectForKey($(true), value("kSecReturnData"));
    const result = Ref();
    const status = $.SecItemCopyMatching(query, result);
    if (status === missing) return "";
    if (status !== 0) throw Error(String(status));
    const data = ObjC.castRefToObject(result[0]);
    return ObjC.unwrap($.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding));
  }

  const data = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
  const updates = $.NSMutableDictionary.dictionary;
  updates.setObjectForKey(data, value("kSecValueData"));
  let status = $.SecItemUpdate(query, updates);
  if (status === missing) {
    query.addEntriesFromDictionary(updates);
    status = $.SecItemAdd(query, null);
  }
  if (status !== 0) throw Error(String(status));
}
`;

function run(operation: "read" | "write", account: string, state?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", script, operation, keychainService, account],
      { timeout: 30000 },
      (error, stdout) => {
        if (error) reject(new Error("macOS 키체인에 접근하지 못했습니다."));
        else resolve(stdout.trim());
      },
    );
    child.stdin?.on("error", reject);
    child.stdin?.end(state);
  });
}

export const accountKeychain: AccountKeychain = {
  async read(account) {
    return (await run("read", account)) || undefined;
  },
  async write(account, state) {
    await run("write", account, state);
  },
};
