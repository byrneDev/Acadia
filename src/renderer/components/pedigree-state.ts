import { useEffect, useState } from "react";
import type { PedigreeState } from "../../shared/pedigree";
import type { ResearchState } from "../../shared/research";

type StateResult = { state?: PedigreeState; error?: unknown };
type Entry = {
  listeners: Set<(result: StateResult) => void>;
  result: StateResult;
  stop: () => void;
};
const subscriptions = new Map<string, Entry>();

export function usePedigree(projectId: string, enabled = true) {
  const [result, setResult] = useState<StateResult>({});
  useEffect(() => {
    setResult({});
    if (!enabled || !window.acadia) return;
    let entry = subscriptions.get(projectId);
    if (!entry) {
      let alive = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let pending = false;
      let again = false;
      const created: Entry = {
        listeners: new Set(),
        result: {},
        stop: () => {},
      };
      const refresh = async () => {
        if (!alive) return;
        if (pending) {
          again = true;
          return;
        }
        pending = true;
        try {
          const state = await window.acadia!.pedigreeState();
          if (alive) created.result = { state };
        } catch (error) {
          if (alive) created.result = { error };
        } finally {
          pending = false;
          if (alive)
            created.listeners.forEach((listener) => listener(created.result));
          if (alive && again) {
            again = false;
            void refresh();
          }
        }
      };
      const off = window.acadia!.onResearchChanged(() => {
        clearTimeout(timer);
        timer = setTimeout(() => void refresh(), 35);
      });
      created.stop = () => {
        alive = false;
        clearTimeout(timer);
        off();
      };
      subscriptions.set(projectId, created);
      entry = created;
      void refresh();
    }
    entry.listeners.add(setResult);
    setResult(entry.result);
    return () => {
      entry!.listeners.delete(setResult);
      if (!entry!.listeners.size) {
        entry!.stop();
        subscriptions.delete(projectId);
      }
    };
  }, [projectId, enabled]);
  return result;
}

/** History remains available; list views use the newest saved revision of each record. */
export function latestRecords<T extends { id: string; revision: number }>(
  records: T[],
): T[] {
  const byId = new Map<string, T>();
  for (const record of records)
    if (!byId.has(record.id) || byId.get(record.id)!.revision < record.revision)
      byId.set(record.id, record);
  return [...byId.values()];
}

export const entityMeta = (projectId: string) => {
  const stamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    projectId,
    revision: 0,
    createdAt: stamp,
    updatedAt: stamp,
  };
};

export function originSummary(
  research: ResearchState,
  pedigree: PedigreeState,
) {
  const included = research.sources.filter(
    (source) => source.inclusion !== "exclude",
  );
  const parent = new Map(included.map((source) => [source.id, source.id]));
  const known = new Set<string>();
  const root = (id: string): string => {
    let current = id;
    while (parent.get(current) && parent.get(current) !== current)
      current = parent.get(current)!;
    return current;
  };
  const unite = (first: string, second: string) => {
    if (parent.has(first) && parent.has(second))
      parent.set(root(second), root(first));
  };
  for (const relationship of pedigree.origins)
    if (
      relationship.status === "confirmed" &&
      parent.has(relationship.sourceId) &&
      parent.has(relationship.relatedSourceId)
    ) {
      unite(relationship.sourceId, relationship.relatedSourceId);
      known.add(relationship.sourceId);
      known.add(relationship.relatedSourceId);
    }
  const hashOwner = new Map<string, string>();
  const duplicateIds = new Set<string>();
  for (const source of included) {
    const version = research.versions.find(
      (entry) => entry.id === source.currentVersionId,
    );
    if (!version?.hash) continue;
    const owner = hashOwner.get(version.hash);
    if (owner) duplicateIds.add(source.id);
    else hashOwner.set(version.hash, source.id);
  }
  const groups = new Map<string, number>();
  for (const id of parent.keys()) {
    const key = root(id);
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  return {
    documents: parent.size,
    linkedFamilies: [...groups.values()].filter((size) => size > 1).length,
    duplicateFiles: duplicateIds.size,
    unknownIndependence: included.filter(
      (source) => !known.has(source.id) && !duplicateIds.has(source.id),
    ).length,
    proposed: pedigree.origins.filter((origin) => origin.status === "proposed")
      .length,
  };
}
