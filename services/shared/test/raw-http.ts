import { request } from "node:http";

export type RawResponse = { status: number; headers: string[]; body: string };

export function rawRequest(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: init.method ?? "GET", headers: init.headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("error", reject);
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.rawHeaders.map((value, index) =>
            index % 2 === 1 && res.rawHeaders[index - 1]!.toLowerCase() === "date" ? "<date>" : value,
          ),
          body: Buffer.concat(chunks).toString("utf8"),
        }),
      );
    });
    req.on("error", reject);
    req.end(init.body);
  });
}
