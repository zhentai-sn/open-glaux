import type { SessionView, TransportEvent } from "../contracts.js";
import type { HarnessRegistry } from "../pi/harness-registry.js";

export type EventSink = (event: TransportEvent) => void | Promise<void>;

export class SseBroker {
  constructor(private readonly registry: HarnessRegistry) {}

  async connect(
    sessionId: string,
    snapshot: () => Promise<SessionView>,
    sink: EventSink,
  ): Promise<() => void> {
    let buffering = true;
    let disconnected = false;
    const buffered: Exclude<TransportEvent, { event: "snapshot" }>[] = [];
    let tail = Promise.resolve();
    const send = (event: TransportEvent) => {
      tail = tail.then(async () => {
        if (!disconnected) await sink(event);
      });
      return tail;
    };
    const unsubscribe = this.registry.subscribe(sessionId, (event) => {
      if (buffering) buffered.push(event);
      else void send(event);
    });

    try {
      await send({ event: "snapshot", data: await snapshot() });
      for (const event of buffered) await send(event);
      buffering = false;
    } catch (error) {
      unsubscribe();
      throw error;
    }

    return () => {
      disconnected = true;
      unsubscribe();
    };
  }
}

export function encodeSse(event: TransportEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}
