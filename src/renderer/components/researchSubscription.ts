import type { ResearchState } from "../../shared/research";

type Subscriber = (state: ResearchState) => void;
interface Store {
  subscribers: Set<Subscriber>;
  state?: ResearchState;
  dispose: () => void;
  refresh: () => void;
}
const stores = new Map<string, Store>();
const health = new Map<string, { stale: boolean; lastSuccess?: number }>();
const healthListeners = new Map<string, Set<() => void>>();
const healthy: { stale: boolean; lastSuccess?: number } = { stale: false };
export const researchHealth = (projectId: string) =>
  health.get(projectId) || healthy;
export function subscribeResearchHealth(
  projectId: string,
  listener: () => void,
) {
  if (!healthListeners.has(projectId))
    healthListeners.set(projectId, new Set());
  healthListeners.get(projectId)!.add(listener);
  return () => {
    healthListeners.get(projectId)?.delete(listener);
  };
}
function publishHealth(projectId: string, stale: boolean) {
  health.set(projectId, {
    stale,
    lastSuccess: stale ? health.get(projectId)?.lastSuccess : Date.now(),
  });
  healthListeners.get(projectId)?.forEach((listener) => listener());
}
export function retryResearchRefresh(projectId: string) {
  stores.get(projectId)?.refresh();
}

// All views of the active project share one listener and one in-flight read.
// Progress bursts are coalesced; an event received during a read triggers a
// follow-up read so a final job result cannot be lost behind older progress.
export function subscribeResearch(projectId: string, subscriber: Subscriber) {
  let store = stores.get(projectId);
  if (!store) {
    let alive = true;
    let reading = false;
    let requested = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const next: Store = {
      subscribers: new Set(),
      dispose: () => {},
      refresh: () => {},
    };
    const read = async () => {
      timer = undefined;
      if (!alive || reading) return;
      reading = true;
      requested = false;
      try {
        const state = await window.acadia!.researchState();
        if (alive) {
          next.state = state;
          publishHealth(projectId, false);
          for (const listener of next.subscribers) listener(state);
        }
      } catch {
        if (alive) publishHealth(projectId, true);
      } finally {
        reading = false;
        if (alive && requested) next.refresh();
      }
    };
    next.refresh = () => {
      requested = true;
      if (!alive || timer || reading) return;
      timer = setTimeout(() => void read(), 35);
    };
    const off = window.acadia!.onResearchChanged(next.refresh);
    next.dispose = () => {
      alive = false;
      if (timer) clearTimeout(timer);
      off();
    };
    stores.set(projectId, next);
    store = next;
  }
  store.subscribers.add(subscriber);
  if (store.state) subscriber(store.state);
  else store.refresh();
  return () => {
    store!.subscribers.delete(subscriber);
    if (!store!.subscribers.size) {
      store!.dispose();
      stores.delete(projectId);
    }
  };
}
