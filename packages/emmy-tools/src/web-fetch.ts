// RED-phase stub. GREEN fills in fetch + turndown + timeout.
export const NETWORK_REQUIRED_TAG = "network-required";

export async function webFetch(
  _url: string,
  _opts: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<{ markdown: string; contentType: string; url: string }> {
  throw new Error("not implemented");
}
