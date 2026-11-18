import { lookup } from "node:dns";
import type { IncomingMessage } from "node:http";
import { get } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

const maxPictureBytes = 256 * 1024;
const imageTypes = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
const nonPublic = new BlockList();
const globalIPv6 = new BlockList();
globalIPv6.addSubnet("2000::", 3, "ipv6");

for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const) {
  nonPublic.addSubnet(address, prefix);
}
nonPublic.addSubnet("2001::", 23, "ipv6");
nonPublic.addSubnet("2001:db8::", 32, "ipv6");
nonPublic.addSubnet("2002::", 16, "ipv6");
nonPublic.addSubnet("3fff::", 20, "ipv6");

// Connect only to the DNS results we validated, without a second DNS lookup.
const lookupPublic: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "");
    const publicAddresses = addresses.filter(({ address, family }) =>
      family === 4
        ? !nonPublic.check(address)
        : family === 6 && globalIPv6.check(address, "ipv6") && !nonPublic.check(address, "ipv6"),
    );
    const first = publicAddresses[0];
    if (!first) return callback(new Error("Profile picture requires a public address"), "");
    if (options.all) return callback(null, publicAddresses);
    callback(null, first.address, first.family);
  });
};

export async function readAccountPicture(picture: string) {
  const signal = AbortSignal.timeout(3000);
  let url = URL.parse(picture);

  for (let redirects = 0; redirects <= 3; redirects++) {
    if (
      url?.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.hostname.startsWith("[") ||
      isIP(url.hostname)
    )
      return;

    const target = url;
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      get(
        target,
        {
          agent: false,
          lookup: lookupPublic,
          rejectUnauthorized: true,
          signal,
          headers: { accept: imageTypes.join(", ") },
        },
        resolve,
      ).once("error", reject);
    });

    const status = response.statusCode ?? 0;
    const location = response.headers.location;
    if (status >= 300 && status < 400 && location) {
      response.destroy();
      url = URL.parse(location, target);
      continue;
    }

    const type = response.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase();
    if (
      status !== 200 ||
      !type ||
      !imageTypes.includes(type) ||
      Number(response.headers["content-length"]) > maxPictureBytes
    ) {
      response.destroy();
      return;
    }

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response) {
      size += chunk.length;
      if (size > maxPictureBytes) return;
      chunks.push(chunk);
    }
    return size
      ? `data:${type};base64,${Buffer.concat(chunks, size).toString("base64")}`
      : undefined;
  }
}
