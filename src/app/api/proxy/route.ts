import { NextResponse } from "next/server";
import dns from "dns";
import { promisify } from "util";
import http from "http";
import https from "https";

const dnsLookup = promisify(dns.lookup);

// ---------------------------------------------------------------------------
// Whitelist of known NFT metadata domains. Only these hosts are allowed.
// ---------------------------------------------------------------------------
const ALLOWED_HOSTNAME_SUFFIXES = [
  "arweave.net",
  "nftstorage.link",
  "ipfs.io",
  "cloudflare-ipfs.com",
  "gateway.pinata.cloud",
  "shdw-drive.genesysgo.net",
  "metadata.degods.com",
  "dweb.link",
  "ipfs.dweb.link",
  "quicknode-ipfs.com",
  "cdn.helius-rpc.com",
];

function isHostnameAllowed(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return ALLOWED_HOSTNAME_SUFFIXES.some(
    (suffix) => lower === suffix || lower.endsWith(`.${suffix}`)
  );
}

// ---------------------------------------------------------------------------
// Private / reserved IP range check (IPv4 + IPv6)
// ---------------------------------------------------------------------------
function isPrivateIP(ip: string): boolean {
  // IPv4 patterns
  if (
    ip.startsWith("127.") || // loopback
    ip.startsWith("10.") || // class A private
    ip.startsWith("0.") || // "this" network
    ip === "255.255.255.255" || // broadcast
    ip.startsWith("169.254.") || // link-local / cloud metadata
    ip.startsWith("192.168.") || // class C private
    ip.startsWith("192.0.0.") // IETF protocol assignments
  ) {
    return true;
  }

  // CGNAT 100.64.0.0/10
  if (ip.startsWith("100.")) {
    const second = parseInt(ip.split(".")[1], 10);
    if (second >= 64 && second <= 127) return true;
  }

  // Benchmarking 198.18.0.0/15
  if (ip.startsWith("198.")) {
    const second = parseInt(ip.split(".")[1], 10);
    if (second === 18 || second === 19) return true;
  }

  // 172.16.0.0 – 172.31.255.255
  if (ip.startsWith("172.")) {
    const second = parseInt(ip.split(".")[1], 10);
    if (second >= 16 && second <= 31) return true;
  }

  // IPv6 patterns
  const lower = ip.toLowerCase();
  if (
    lower === "::1" || // loopback
    lower === "::" || // unspecified
    lower.startsWith("fc") ||
    lower.startsWith("fd") || // unique-local
    lower.startsWith("fe80") || // link-local
    lower.startsWith("::ffff:127.") || // mapped loopback
    lower.startsWith("::ffff:10.") || // mapped class A
    lower.startsWith("::ffff:192.168.") || // mapped class C
    lower.startsWith("::ffff:169.254.") // mapped link-local
  ) {
    return true;
  }

  // Mapped 172.16-31.x.x
  if (lower.startsWith("::ffff:172.")) {
    const quad = lower.split("::ffff:")[1];
    if (quad) {
      const second = parseInt(quad.split(".")[1], 10);
      if (second >= 16 && second <= 31) return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Fetch that pins to a pre-resolved IP to prevent DNS-rebinding (TOCTOU).
// We resolve DNS once, validate the IP, then force the connection to that
// exact IP by using a custom http/https Agent with an explicit `lookup`
const globalHttpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 10,
  maxFreeSockets: 5,
  timeout: 30000,
});

const globalHttpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 10,
  maxFreeSockets: 5,
  timeout: 30000,
});

// ---------------------------------------------------------------------------
// Fetch that pins to a pre-resolved IP to prevent DNS-rebinding (TOCTOU).
// We resolve DNS once, validate the IP, then force the connection to that
// exact IP by using a custom lookup per-request while reusing a global Agent.
// ---------------------------------------------------------------------------
async function safeFetch(targetUrl: URL, timeoutMs: number): Promise<Response> {
  const resolved = await dnsLookup(targetUrl.hostname, { family: 4 });
  const pinnedIP = resolved.address;
  const family = resolved.family; // 4

  if (isPrivateIP(pinnedIP)) {
    throw new Error("Resolved IP is in a private/reserved range");
  }

  // Custom lookup that always returns the pinned IP so Node never re-resolves.
  const pinnedLookup = (
    _hostname: string,
    options: Record<string, unknown>,
    callback: (
      err: NodeJS.ErrnoException | null,
      addresses: string | Array<{ address: string; family: number }>,
      family?: number
    ) => void
  ) => {
    if (options.all) {
      callback(null, [{ address: pinnedIP, family }]);
    } else {
      callback(null, pinnedIP, family);
    }
  };

  const agent = targetUrl.protocol === "https:" ? globalHttpsAgent : globalHttpAgent;

  let timer: NodeJS.Timeout | undefined;

  try {
    return await new Promise<Response>((resolve, reject) => {
      const lib = targetUrl.protocol === "https:" ? https : http;

      const req = lib.request(
        targetUrl,
        {
          agent,
          method: "GET",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Host: targetUrl.hostname,
          },
          lookup: pinnedLookup as typeof dns.lookup,
        },
        (res) => {
          const chunks: Buffer[] = [];
          let receivedBytes = 0;
          const MAX_BODY = 1 * 1024 * 1024; // 1 MB

          res.on("data", (chunk: Buffer) => {
            receivedBytes += chunk.length;
            if (receivedBytes > MAX_BODY) {
              req.destroy(new Error("Response body exceeded 1 MB limit"));
              return;
            }
            chunks.push(chunk);
          });

          res.on("end", () => {
            const body = Buffer.concat(chunks);
            resolve(
              new Response(body, {
                status: res.statusCode ?? 500,
                statusText: res.statusMessage,
                headers: res.headers as HeadersInit,
              })
            );
          });

          res.on("error", reject);
        }
      );

      // Hard timeout for total request duration
      timer = setTimeout(() => {
        req.destroy(new Error("Request timeout"));
      }, timeoutMs);

      req.on("error", reject);
      req.end();
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const urlParam = searchParams.get("url");

  if (!urlParam) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(decodeURIComponent(urlParam));
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  // 1. Protocol check – only http(s)
  if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
    return NextResponse.json({ error: "Only http/https protocols are allowed" }, { status: 400 });
  }

  // 2. Hostname whitelist
  if (!isHostnameAllowed(targetUrl.hostname)) {
    return NextResponse.json(
      { error: "Hostname not in allowlist for NFT metadata" },
      { status: 403 }
    );
  }

  try {
    // 3. DNS-pinned fetch with timeout + size limit
    const response = await safeFetch(targetUrl, 5000);

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch remote metadata" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("Proxy error (full):", error);

    if (msg.includes("private") || msg.includes("reserved")) {
      return NextResponse.json({ error: "Forbidden target address" }, { status: 403 });
    }
    if (msg.includes("1 MB")) {
      return NextResponse.json({ error: "Response too large" }, { status: 413 });
    }

    return NextResponse.json({ error: "Internal server error fetching metadata" }, { status: 500 });
  }
}
