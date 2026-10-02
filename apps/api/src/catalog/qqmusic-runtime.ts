import { once } from "node:events";
import type { AddressInfo } from "node:net";
import qqMusicApiApp from "@sansenjian/qq-music-api/app";

export interface EmbeddedQqMusicApi {
  baseUrl: string;
  close(): Promise<void>;
}

export async function startEmbeddedQqMusicApi(port: number, host = "127.0.0.1"): Promise<EmbeddedQqMusicApi> {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("QQ_MUSIC_API_PORT must be an integer between 0 and 65535.");
  }

  const server = qqMusicApiApp.listen(port, host);
  try {
    await once(server, "listening");
  } catch (error) {
    server.close();
    throw new Error(`Could not start the bundled QQ Music API on ${host}:${port}.`, { cause: error });
  }

  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("The bundled QQ Music API did not report a TCP address.");
  }

  const boundPort = (address as AddressInfo).port;
  return {
    baseUrl: `http://${host}:${boundPort}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => error ? reject(error) : resolve());
    }),
  };
}
