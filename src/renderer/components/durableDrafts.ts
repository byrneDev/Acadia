import { useCallback, useEffect, useSyncExternalStore } from "react";
import type {
  DraftJSONValue,
  ResearchDraft,
  ResearchDraftKind,
} from "../../shared/research";

type Options<T> = {
  projectId: string;
  key: string;
  kind: ResearchDraftKind;
  targetId?: string;
  initial: T;
  baseSignature?: string;
};
type Envelope<T> = { buffer: T; baseSignature: string };
type Session<T> = Options<T> & {
  value: T;
  dirty: boolean;
  loading: boolean;
  saving: boolean;
  committing: boolean;
  committedInitial?: T;
  error: string;
  recovered: boolean;
  conflict: boolean;
  revision: number;
  sequence: number;
  written: number;
};
const sessions = new Map<string, Session<unknown>>();
const records = new Map<string, ResearchDraft>();
const loaded = new Set<string>();
const listeners = new Map<string, Set<() => void>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const writes = new Map<string, Promise<void>>();
const clears = new Map<string, Promise<void>>();
const commits = new Map<string, Promise<unknown>>();
const globalListeners = new Set<() => void>();
let generation = 0;
const idFor = (projectId: string, key: string) => `${projectId}\n${key}`;
function publish<T>(id: string, next: Session<T>) {
  sessions.set(id, next as Session<unknown>);
  listeners.get(id)?.forEach((listener) => listener());
  generation += 1;
  globalListeners.forEach((listener) => listener());
}
export async function hydrateDrafts(projectId: string, replace = false) {
  if (loaded.has(projectId) && !replace) return;
  const saved = await window.acadia!.researchDrafts(projectId);
  if (replace) {
    // A same-ID archive can replace saved drafts. The caller flushes before
    // import and remounts editors after this cache is replaced.
    for (const [id, state] of sessions)
      if (state.projectId === projectId) {
        if (timers.has(id)) clearTimeout(timers.get(id));
        timers.delete(id);
        sessions.delete(id);
      }
    for (const [id, record] of records)
      if (record.projectId === projectId) records.delete(id);
  }
  for (const record of saved)
    if (record.projectId === projectId)
      records.set(idFor(projectId, record.key), record);
  loaded.add(projectId);
  generation += 1;
  globalListeners.forEach((listener) => listener());
}
function session<T>(options: Options<T>): Session<T> {
  const id = idFor(options.projectId, options.key);
  const existing = sessions.get(id) as Session<T> | undefined;
  if (existing) return existing;
  const saved = records.get(id);
  const envelope = saved?.value as Envelope<T> | undefined;
  const valid =
    envelope &&
    typeof envelope === "object" &&
    "buffer" in envelope &&
    typeof envelope.baseSignature === "string";
  const baseSignature =
    options.baseSignature ?? JSON.stringify(options.initial);
  const value: Session<T> = {
    ...options,
    // A recovered buffer keeps its persisted identity even when a form has
    // since acquired a saved record or a newer routing convention.
    targetId: valid ? saved?.targetId : options.targetId,
    baseSignature: valid ? envelope.baseSignature : baseSignature,
    value: valid ? envelope.buffer : options.initial,
    dirty: Boolean(valid),
    loading: !loaded.has(options.projectId),
    saving: false,
    committing: false,
    error: "",
    recovered: Boolean(valid),
    conflict: Boolean(valid && envelope.baseSignature !== baseSignature),
    revision: saved?.revision || 0,
    sequence: 0,
    written: 0,
  };
  sessions.set(id, value as Session<unknown>);
  return value;
}
async function flush(id: string) {
  if (clears.has(id)) await clears.get(id);
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  if (writes.has(id)) {
    await writes.get(id);
    if ((sessions.get(id)?.sequence || 0) > (sessions.get(id)?.written || 0))
      return flush(id);
    return;
  }
  const run = async () => {
    let current = sessions.get(id);
    while (current && current.sequence > current.written) {
      const submitted = current;
      publish(id, { ...current, saving: true, error: "" });
      try {
        const saved = await window.acadia!.saveResearchDraft({
          projectId: submitted.projectId,
          key: submitted.key,
          kind: submitted.kind,
          targetId: submitted.targetId,
          // Optional form fields may be undefined in React state; the durable
          // contract accepts JSON, so omit them before crossing the bridge.
          value: JSON.parse(
            JSON.stringify({
              buffer: submitted.value,
              baseSignature: submitted.baseSignature || "",
            }),
          ) as DraftJSONValue,
          expectedRevision: submitted.revision,
        });
        records.set(id, saved);
        const latest = sessions.get(id)!;
        publish(id, {
          ...latest,
          revision: saved.revision,
          written: submitted.sequence,
          saving: latest.committing,
          error: "",
        });
      } catch {
        publish(id, {
          ...sessions.get(id)!,
          saving: sessions.get(id)!.committing,
          error:
            "Your changes are still open, but this private draft could not be saved. Retry before closing Acadia.",
        });
        throw new Error(
          "A private research draft could not be saved. Keep this investigation open and retry.",
        );
      }
      current = sessions.get(id);
    }
  };
  const pending = run();
  writes.set(id, pending);
  try {
    await pending;
  } finally {
    writes.delete(id);
  }
}
export async function flushDrafts(projectId?: string) {
  await Promise.all(
    [...commits.entries()]
      .filter(([id]) => !projectId || sessions.get(id)?.projectId === projectId)
      .map(([, pending]) => pending),
  );
  await Promise.all(
    [...sessions.entries()]
      .filter(([, state]) => !projectId || state.projectId === projectId)
      .map(([id]) => flush(id)),
  );
}
export function useDurableDraft<T>(options: Options<T>) {
  const id = idFor(options.projectId, options.key);
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!listeners.has(id)) listeners.set(id, new Set());
      listeners.get(id)!.add(listener);
      return () => {
        listeners.get(id)?.delete(listener);
      };
    },
    [id],
  );
  const state = useSyncExternalStore(
    subscribe,
    () => session(options),
    () => session(options),
  );
  const initialText = JSON.stringify(options.initial);
  useEffect(() => {
    let alive = true;
    if (!loaded.has(options.projectId)) {
      void hydrateDrafts(options.projectId)
        .then(() => {
          if (!alive) return;
          const current = sessions.get(id)!;
          if (!current.sequence) {
            sessions.delete(id);
            publish(id, session(options));
          } else publish(id, { ...current, loading: false });
        })
        .catch(() => {
          if (alive)
            publish(id, {
              ...sessions.get(id)!,
              loading: false,
              error:
                "Saved drafts could not be read. Reopen this investigation before editing.",
            });
        });
    }
    return () => {
      alive = false;
    };
  }, [id]);
  useEffect(() => {
    const current = session(options);
    const base = options.baseSignature ?? initialText;
    const revision = (value: unknown) =>
      value &&
      typeof value === "object" &&
      "revision" in value &&
      typeof value.revision === "number"
        ? value.revision
        : 0;
    if (revision(current.value) > revision(options.initial)) return;
    if (
      current.committedInitial &&
      JSON.stringify(current.committedInitial) === initialText &&
      current.baseSignature !== base
    ) {
      publish(id, {
        ...current,
        baseSignature: base,
        conflict: false,
        initial: options.initial,
        sequence: current.dirty ? current.sequence + 1 : current.sequence,
      });
      if (current.dirty) void flush(id).catch(() => {});
      return;
    }
    if (
      !current.dirty &&
      !current.saving &&
      (JSON.stringify(current.value) !== initialText ||
        current.baseSignature !== base)
    )
      publish(id, {
        ...current,
        value: options.initial,
        initial: options.initial,
        baseSignature: base,
      });
    else if (
      current.dirty &&
      !current.committing &&
      current.baseSignature !== base &&
      !current.conflict
    )
      publish(id, { ...current, conflict: true });
  }, [id, initialText, options.baseSignature, state.committedInitial]);
  const edit = (value: T) => {
    const current = session(options);
    if (current.loading) return;
    publish(id, {
      ...current,
      value,
      dirty: true,
      sequence: current.sequence + 1,
      error: "",
    });
    if (timers.has(id)) clearTimeout(timers.get(id));
    timers.set(
      id,
      setTimeout(() => void flush(id).catch(() => {}), 180),
    );
  };
  const finishRecordSave = async (
    submitted: Session<T>,
    next: T,
    reset?: T,
  ) => {
    await flush(id);
    const clear = async () => {
      const current = session(options);
      if (current.revision)
        await window.acadia!.deleteResearchDraft(
          options.projectId,
          options.key,
          current.revision,
        );
      records.delete(id);
      const latest = session(options);
      if (latest.sequence === submitted.sequence) {
        publish(id, {
          ...latest,
          value: reset ?? next,
          committedInitial: reset ?? next,
          baseSignature: options.baseSignature ?? JSON.stringify(reset ?? next),
          dirty: false,
          recovered: false,
          conflict: false,
          revision: 0,
          sequence: 0,
          written: 0,
        });
      } else {
        const value =
          typeof latest.value === "object" &&
          latest.value &&
          typeof next === "object" &&
          next
            ? ({
                ...latest.value,
                ...Object.fromEntries(
                  Object.entries(next).filter(([key]) =>
                    ["revision", "createdAt", "updatedAt"].includes(key),
                  ),
                ),
              } as T)
            : latest.value;
        publish(id, {
          ...latest,
          value,
          committedInitial: next,
          revision: 0,
          written: 0,
          conflict: false,
          baseSignature: options.baseSignature ?? JSON.stringify(next),
        });
      }
    };
    const pending = clear();
    clears.set(id, pending);
    try {
      await pending;
    } finally {
      clears.delete(id);
    }
    await flush(id);
  };
  const discard = async () => {
    if (timers.has(id)) clearTimeout(timers.get(id));
    timers.delete(id);
    await clears.get(id);
    await writes.get(id)?.catch(() => {});
    const current = session(options);
    if (current.committing)
      throw new Error(
        "Wait for the current assessment save before discarding.",
      );
    const sequence = current.sequence;
    const clear = async () => {
      if (current.revision)
        await window.acadia!.deleteResearchDraft(
          options.projectId,
          options.key,
          current.revision,
        );
      records.delete(id);
      const latest = session(options);
      if (latest.sequence !== sequence) {
        publish(id, { ...latest, revision: 0, written: 0 });
        return;
      }
      publish(id, {
        ...latest,
        value: options.initial,
        initial: options.initial,
        baseSignature: options.baseSignature ?? initialText,
        dirty: false,
        recovered: false,
        conflict: false,
        error: "",
        revision: 0,
        sequence: 0,
        written: 0,
      });
    };
    const pending = clear();
    clears.set(id, pending);
    try {
      await pending;
    } finally {
      clears.delete(id);
    }
    await flush(id);
  };
  const saved = async (next: T, reset?: T) => {
    // The render's value is the submitted buffer, even if typing continued while its save ran.
    const submitted = state;
    publish(id, { ...session(options), committing: true, saving: true });
    const pending = finishRecordSave(submitted, next, reset);
    commits.set(id, pending);
    try {
      await pending;
    } catch (error) {
      publish(id, {
        ...session(options),
        error:
          "The record was saved, but its private draft could not be cleared. Retry before closing.",
      });
      throw error;
    } finally {
      commits.delete(id);
      publish(id, { ...session(options), committing: false, saving: false });
    }
  };
  const persist = async (work: (value: T) => Promise<T>, reset?: T) => {
    const current = session(options);
    if (current.loading)
      throw new Error("Wait for the recovered draft to load before saving.");
    if (current.committing)
      throw new Error("This assessment is already saving.");
    if (current.conflict)
      throw new Error(
        "The saved record changed since this draft began. Review your draft and use the latest record before saving.",
      );
    const submitted = current;
    publish(id, { ...current, committing: true, saving: true });
    const pending = (async () => {
      await flush(id);
      const next = await work(submitted.value);
      await finishRecordSave(submitted, next, reset);
      return next;
    })();
    commits.set(id, pending);
    try {
      return await pending;
    } finally {
      commits.delete(id);
      publish(id, { ...session(options), committing: false, saving: false });
    }
  };
  return {
    ...state,
    pending: state.sequence > state.written,
    liveInitial: options.initial,
    edit,
    flush: () => flush(id),
    discard,
    persist,
    saved,
    acknowledgeConflict: () => {
      const current = session(options);
      const metadata =
        typeof options.initial === "object" && options.initial
          ? Object.fromEntries(
              Object.entries(options.initial).filter(([key]) =>
                ["revision", "createdAt", "updatedAt"].includes(key),
              ),
            )
          : {};
      const value =
        typeof current.value === "object" && current.value
          ? ({ ...current.value, ...metadata } as T)
          : current.value;
      publish(id, {
        ...current,
        value,
        conflict: false,
        baseSignature: options.baseSignature ?? initialText,
        sequence: current.sequence + 1,
      });
      void flush(id).catch(() => {});
    },
  };
}

export function useDraftHealth(projectId: string) {
  useSyncExternalStore(
    (listener) => {
      globalListeners.add(listener);
      return () => {
        globalListeners.delete(listener);
      };
    },
    () => generation,
    () => generation,
  );
  const active = [...sessions.values()].filter(
    (value) => value.projectId === projectId && value.dirty,
  );
  const unopened = [...records.entries()]
    .filter(
      ([id, record]) => record.projectId === projectId && !sessions.has(id),
    )
    .map(([, record]) => ({
      key: record.key,
      kind: record.kind,
      dirty: true,
      recovered: true,
      conflict: false,
      saving: false,
      error: "",
      sequence: 0,
      written: 0,
    }));
  return [...active, ...unopened];
}
export function readDraftBuffer<T>(
  projectId: string,
  key: string,
): T | undefined {
  const id = idFor(projectId, key);
  const current = sessions.get(id);
  if (current) return current.dirty ? (current.value as T) : undefined;
  const value = records.get(id)?.value;
  return value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "buffer" in value
    ? (value.buffer as T)
    : undefined;
}
export function writeDraftBuffer<T>(
  projectId: string,
  key: string,
  kind: ResearchDraftKind,
  value: T,
) {
  const options = { projectId, key, kind, initial: value, baseSignature: key };
  const id = idFor(projectId, key),
    current = session(options);
  publish(id, {
    ...current,
    value,
    dirty: true,
    loading: false,
    sequence: current.sequence + 1,
  });
  if (timers.has(id)) clearTimeout(timers.get(id));
  timers.set(
    id,
    setTimeout(() => void flush(id).catch(() => {}), 180),
  );
}
export async function clearDraftBuffer(projectId: string, key: string) {
  const id = idFor(projectId, key),
    sequence = sessions.get(id)?.sequence;
  await flush(id);
  const clear = async () => {
    const revision = sessions.get(id)?.revision || records.get(id)?.revision;
    if (revision)
      await window.acadia!.deleteResearchDraft(projectId, key, revision);
    records.delete(id);
    const current = sessions.get(id);
    if (current)
      publish(
        id,
        current.sequence === sequence
          ? {
              ...current,
              dirty: false,
              recovered: false,
              revision: 0,
              sequence: 0,
              written: 0,
            }
          : { ...current, revision: 0, written: 0 },
      );
    else {
      generation += 1;
      globalListeners.forEach((listener) => listener());
    }
  };
  const pending = clear();
  clears.set(id, pending);
  try {
    await pending;
  } catch (error) {
    const current = sessions.get(id);
    if (current)
      publish(id, {
        ...current,
        error:
          "This private editing draft could not be cleared. Its text is still recoverable.",
      });
    throw error;
  } finally {
    clears.delete(id);
  }
  await flush(id);
}
