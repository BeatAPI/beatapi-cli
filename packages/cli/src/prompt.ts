export async function promptSecret(
  label = "BeatAPI API key: ",
): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      "Interactive login requires a TTY. Set BEATAPI_API_KEY instead.",
    );
  }

  process.stdout.write(label);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  return new Promise<string>((resolve, reject) => {
    let value = "";

    const cleanup = () => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };

    const onData = (chunk: string) => {
      if (chunk === "\u0003") {
        cleanup();
        reject(new Error("Login cancelled."));
        return;
      }
      if (chunk === "\r" || chunk === "\n") {
        cleanup();
        resolve(value);
        return;
      }
      if (chunk === "\u007f" || chunk === "\b") {
        value = value.slice(0, -1);
        return;
      }
      if (chunk >= " ") value += chunk;
    };

    process.stdin.on("data", onData);
  });
}
