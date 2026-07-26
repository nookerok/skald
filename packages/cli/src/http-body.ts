export async function readJsonBody(req: { on: Function; destroy: Function }, maxBytes = 16384): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;

  return new Promise<unknown>((resolve, reject) => {
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy(new Error("request body too large"));
        reject(new Error("request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf-8");
      if (!raw) {
        reject(new Error("empty body"));
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}
