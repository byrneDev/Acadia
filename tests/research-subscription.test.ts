import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeResearch } from "../src/renderer/components/researchSubscription";
import type { ResearchState } from "../src/shared/research";

const empty = (): ResearchState => ({
  sources: [],
  versions: [],
  claims: [],
  tasks: [],
  jobs: [],
  discoveries: [],
  runs: [],
});
const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function setup(read = vi.fn().mockResolvedValue(empty())) {
  vi.useFakeTimers();
  let changed = () => {};
  const off = vi.fn();
  const listen = vi.fn((callback: () => void) => {
    changed = callback;
    return off;
  });
  vi.stubGlobal("window", {
    acadia: { researchState: read, onResearchChanged: listen },
  });
  return { read, listen, off, changed: () => changed() };
}

describe("shared research event reads", () => {
  it("shares one listener and coalesces a progress burst across views", async () => {
    const api = setup();
    const first = vi.fn(),
      second = vi.fn();
    disposers.push(
      subscribeResearch("shared", first),
      subscribeResearch("shared", second),
    );
    for (let i = 0; i < 30; i++) api.changed();
    await vi.advanceTimersByTimeAsync(40);
    expect(api.listen).toHaveBeenCalledTimes(1);
    expect(api.read).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
  it("reads again when final progress arrives during an in-flight request", async () => {
    let resolve!: (value: ResearchState) => void;
    const firstRead = new Promise<ResearchState>((done) => {
      resolve = done;
    });
    const final = empty();
    const api = setup(
      vi.fn().mockReturnValueOnce(firstRead).mockResolvedValue(final),
    );
    const listener = vi.fn();
    disposers.push(subscribeResearch("in-flight", listener));
    await vi.advanceTimersByTimeAsync(40);
    api.changed();
    resolve(empty());
    await vi.advanceTimersByTimeAsync(40);
    expect(api.read).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(final);
  });
  it("drops a result after its final view closes", async () => {
    let resolve!: (value: ResearchState) => void;
    const pending = new Promise<ResearchState>((done) => {
      resolve = done;
    });
    const api = setup(vi.fn().mockReturnValue(pending));
    const listener = vi.fn();
    const stop = subscribeResearch("old-project", listener);
    await vi.advanceTimersByTimeAsync(40);
    stop();
    resolve(empty());
    await vi.advanceTimersByTimeAsync(40);
    expect(api.off).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();
  });
});
