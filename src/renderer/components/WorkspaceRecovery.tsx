import {
  Component,
  useCallback,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { flushDrafts, useDraftHealth } from "./durableDrafts";
import { MaintenancePanel } from "./MaintenancePanel";
import {
  researchHealth,
  retryResearchRefresh,
  subscribeResearchHealth,
} from "./researchSubscription";

let saveWorkspaceBeforeReload: (() => Promise<void>) | undefined;
/** Retain the last editor save callback if a rendering exception unmounts App. */
export function registerWorkspaceRecovery(save: () => Promise<void>) {
  saveWorkspaceBeforeReload = save;
}

export class WorkspaceErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean; error: string; maintenance: boolean }
> {
  state = { failed: false, error: "", maintenance: false };
  private stopBeforeClose?: () => void;
  componentDidCatch() {
    if (window.location.hash !== "#releaser") {
      this.stopBeforeClose = window.acadia?.onBeforeClose(async () => {
        await flushDrafts();
        await saveWorkspaceBeforeReload?.();
      });
    }
  }
  componentWillUnmount() {
    this.stopBeforeClose?.();
  }
  static getDerivedStateFromError() {
    return { failed: true, error: "", maintenance: false };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="loading-screen" role="alert">
        <h1>Acadia could not display this workspace.</h1>
        <p>
          Saved research remains on this computer. Reload to reopen it; private
          drafts will be saved first where possible.
        </p>
        {this.state.error && <p>{this.state.error}</p>}
        <button
          className="button primary"
          onClick={async () => {
            try {
              await flushDrafts();
              await saveWorkspaceBeforeReload?.();
              window.location.reload();
            } catch {
              this.setState({
                error:
                  "Some open drafts could not be saved. Keep Acadia open and retry reload when storage is available.",
              });
            }
          }}
        >
          Save drafts and reload
        </button>
        {window.location.hash !== "#releaser" && (
          <>
            <button
              className="button quiet"
              onClick={() => this.setState({ maintenance: true })}
            >
              Backup, recovery and updates
            </button>
            {this.state.maintenance && (
              <MaintenancePanel
                onClose={() => this.setState({ maintenance: false })}
                onError={() =>
                  this.setState({
                    error:
                      "Recovery could not complete. Your saved research remains available.",
                  })
                }
              />
            )}
          </>
        )}
      </main>
    );
  }
}
export function ResearchRefreshNotice({ projectId }: { projectId: string }) {
  const subscribe = useCallback(
    (listener: () => void) => subscribeResearchHealth(projectId, listener),
    [projectId],
  );
  const state = useSyncExternalStore(
    subscribe,
    () => researchHealth(projectId),
    () => researchHealth(projectId),
  );
  if (!state.stale) return null;
  return (
    <div className="error-banner" role="alert">
      <span>
        The latest research changes could not be loaded. This view may be out of
        date
        {state.lastSuccess
          ? `; last refreshed ${new Date(state.lastSuccess).toLocaleTimeString()}`
          : ""}
        .
      </span>
      <button
        className="button quiet"
        onClick={() => retryResearchRefresh(projectId)}
      >
        Retry research refresh
      </button>
    </div>
  );
}
export function DraftRecoveryNotice({ projectId }: { projectId: string }) {
  const drafts = useDraftHealth(projectId);
  if (!drafts.length) return null;
  const failure = drafts.some((draft) => draft.error);
  const conflict = drafts.some((draft) => draft.conflict);
  const saving = drafts.some(
    (draft) => draft.saving || draft.sequence !== draft.written,
  );
  return (
    <details
      className={`draft-recovery-status ${failure || conflict ? "warning-text" : ""}`}
    >
      <summary>
        {failure
          ? "Private draft save needs attention"
          : conflict
            ? "A recovered draft needs comparison"
            : saving
              ? "Saving private drafts…"
              : `${drafts.length} private editing draft${drafts.length === 1 ? "" : "s"} saved locally`}
      </summary>
      <p>
        These buffers are recoverable editing work, not reviewed evidence or
        released content. Use each form’s Save action to apply its changes.
      </p>
      <ul>
        {drafts.map((draft) => (
          <li key={draft.key}>
            {draft.kind.replaceAll("-", " ")}
            {draft.recovered ? " · recovered draft" : ""}
            {draft.conflict
              ? " · the saved record changed; compare it before applying"
              : ""}
            {draft.error && <span role="alert"> · {draft.error}</span>}
          </li>
        ))}
      </ul>
      {failure && (
        <button
          className="button quiet"
          onClick={() => void flushDrafts(projectId).catch(() => {})}
        >
          Retry saving private drafts
        </button>
      )}
    </details>
  );
}
