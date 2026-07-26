export async function readJsonBody(req: { on: Function; removeListener: Function }, maxBytes = 16384): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  let oversized = false;
  let finished = false;

  return new Promise<unknown>((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      if (oversized || finished) return;
      total += chunk.length;
      if (total > maxBytes) {
        oversized = true;
        reject(new Error("request body too large"));
        return;
      }
      chunks.push(chunk);
    };

    const onEnd = () => {
      finished = true;
      if (oversized) return;
      const raw = Buffer.concat(chunks).toString("utf-8");
      if (!raw) { reject(new Error("empty body")); return; }
      try { resolve(JSON.parse(raw)); }
      catch { reject(new Error("invalid JSON")); }
    };

    const onError = (err: Error) => {
      finished = true;
      if (!oversized) reject(err);
    };

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}
