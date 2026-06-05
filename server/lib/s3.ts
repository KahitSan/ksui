// Zero-dependency S3 client (AWS Signature V4) for the two operations this
// plugin needs: PutObject and DeleteObject against an S3-compatible endpoint
// (DigitalOcean Spaces in prod, MinIO in dev/CI).
//
// A real @aws-sdk/client-s3 dependency is deliberately avoided: the plugin's
// node_modules is a symlink to the KERNEL's tree in dev, CI and prod (see
// .github/workflows/ci.yml "Link node_modules" + deploy.yml rsync step), so a
// new runtime dep can only ship through a kernel release. SigV4 over fetch is
// ~100 lines and Node 22's global fetch + node:crypto cover it entirely.
//
// Requests are path-style (`<endpoint>/<bucket>/<key>`), which both Spaces and
// MinIO accept. Public links are built from S3_CDN_URL instead of the request
// endpoint so prod links point at the CDN domain.
//
// Env (inherited from the kernel process env; prod source: /opt/kserp/.env):
//   S3_ENDPOINT    https://sgp1.digitaloceanspaces.com | http://127.0.0.1:9000
//   S3_REGION      sgp1 | us-east-1 (MinIO default)
//   S3_BUCKET      bucket name
//   S3_ACCESS_KEY / S3_SECRET_KEY
//   S3_CDN_URL     public base for stored links (default: <endpoint>/<bucket>)
import { createHash, createHmac } from "node:crypto";

type S3Config = {
  endpoint: URL;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  cdnUrl: string;
};

function config(): S3Config | null {
  const { S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY, S3_CDN_URL } =
    process.env;
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY || !S3_SECRET_KEY) return null;
  return {
    endpoint: new URL(S3_ENDPOINT),
    region: S3_REGION || "us-east-1",
    bucket: S3_BUCKET,
    accessKey: S3_ACCESS_KEY,
    secretKey: S3_SECRET_KEY,
    cdnUrl: (S3_CDN_URL || `${S3_ENDPOINT.replace(/\/+$/, "")}/${S3_BUCKET}`).replace(/\/+$/, ""),
  };
}

/** True when the process has a complete S3 configuration. Upload routes 503
 * when this is false — object storage is the ONLY place new files go (no disk
 * fallback), so a half-configured server must fail loudly, not silently. */
export function s3Enabled(): boolean {
  return config() !== null;
}

/** Public URL stored in s3_link for a given object key. */
export function s3PublicUrl(key: string): string {
  const cfg = config();
  if (!cfg) throw new Error("S3 is not configured");
  return `${cfg.cdnUrl}/${key}`;
}

/** Derive the S3 object key from a stored public URL (s3_link) — the inverse of
 * s3PublicUrl, which builds `${cdnUrl}/${key}`. Strips the configured cdnUrl
 * prefix so the bucket segment in a path-style URL (MinIO:
 * `http://host:9000/<bucket>/uploads/x`) is NOT mistaken for part of the key,
 * while a CDN-domain URL (prod: `https://cdn.hilinga.com/uploads/x`) yields the
 * same `uploads/x`. Falls back to the URL pathname for a value that predates the
 * current cdnUrl. Returns null when no key can be recovered. */
export function s3KeyFromUrl(s3Link: string | null | undefined): string | null {
  if (!s3Link) return null;
  const cfg = config();
  if (cfg) {
    const prefix = `${cfg.cdnUrl.replace(/\/+$/, "")}/`;
    if (s3Link.startsWith(prefix)) return s3Link.slice(prefix.length) || null;
  }
  try {
    return new URL(s3Link).pathname.replace(/^\/+/, "") || null;
  } catch {
    return null;
  }
}

const sha256hex = (data: Buffer | string): string =>
  createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac("sha256", key).update(data).digest();

// Strict RFC 3986 encoding of one path segment, per the S3 canonical-URI
// rules (encodeURIComponent leaves !'()* unencoded; S3 requires them encoded).
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

async function s3Request(
  method: "PUT" | "DELETE",
  key: string,
  body?: Buffer,
  contentType?: string,
  extraHeaders: Record<string, string> = {},
): Promise<void> {
  const cfg = config();
  if (!cfg) throw new Error("S3 is not configured");

  const amzDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const dateStamp = amzDate.slice(0, 8);
  const canonicalUri = "/" + [cfg.bucket, ...key.split("/")].map(encodeSegment).join("/");
  const payloadHash = sha256hex(body ?? Buffer.alloc(0));

  // Headers that participate in the signature. `host` is signed but NOT
  // passed to fetch (undici forbids overriding it); the actual request goes
  // to cfg.endpoint.origin so the wire value matches the signed value.
  const headers: Record<string, string> = {
    host: cfg.endpoint.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...(contentType ? { "content-type": contentType } : {}),
    ...extraHeaders,
  };
  const signedHeaderNames = Object.keys(headers)
    .map((h) => h.toLowerCase())
    .sort();
  const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${headers[h].trim()}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = [
    method,
    canonicalUri,
    "", // no query string for PutObject/DeleteObject
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${cfg.secretKey}`, dateStamp), cfg.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  const { host: _host, ...requestHeaders } = headers;
  const res = await fetch(`${cfg.endpoint.origin}${canonicalUri}`, {
    method,
    headers: {
      ...requestHeaders,
      authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    // Copy into a plain Uint8Array: TS 5.x types Buffer over ArrayBufferLike,
    // which fetch's BodyInit rejects. Bodies are ≤10MB so the copy is cheap.
    body: body ? new Uint8Array(body) : undefined,
  });
  // DeleteObject on a missing key is a success in S3 (204); treat 404 from
  // non-conforming stores the same way.
  if (!res.ok && !(method === "DELETE" && res.status === 404)) {
    const detail = await res.text().catch(() => "");
    throw new Error(`S3 ${method} ${key} failed: ${res.status} ${detail.slice(0, 300)}`);
  }
}

/** Upload an object. Sends x-amz-acl: public-read — required on DO Spaces so
 * the CDN can serve it; MinIO accepts the header and governs access through
 * its bucket policy instead. */
export async function s3PutObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await s3Request("PUT", key, body, contentType, { "x-amz-acl": "public-read" });
}

/** Best-effort object removal (missing keys do not throw). */
export async function s3DeleteObject(key: string): Promise<void> {
  await s3Request("DELETE", key);
}
