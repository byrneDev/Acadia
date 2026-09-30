import { useEffect, useState } from "react";
import { Modal } from "./Dialogs";
import type {
  BackupInfo,
  DiagnosticReport,
  UpdateCheck,
} from "../../shared/maintenance";

export function MaintenancePanel({
  onClose,
  onError,
}: {
  onClose: () => void;
  onError?: (error: unknown) => void;
}) {
  const [backups, setBackups] = useState<BackupInfo[]>([]),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const [report, setReport] = useState<DiagnosticReport>(),
    [update, setUpdate] = useState<UpdateCheck>();
  useEffect(() => {
    void window.acadia
      ?.listBackups()
      .then(setBackups)
      .catch((e) => setError(String(e)));
  }, []);
  async function work(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      onError?.(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Backup, recovery and updates"
      subtitle="Keep an independent copy of your research and inspect application health."
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <section>
        <h3>Research library backups</h3>
        <p>
          A checked backup contains your library, private drafts and original
          files. Credentials are excluded. Choose another drive for protection
          from disk failure. Restoring preserves the current workspace and
          restarts Acadia.
        </p>
        <div className="modal-actions">
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              void work(async () => {
                const b = await window.acadia!.createBackup();
                if (b) {
                  setBackups((x) => [b, ...x.filter((v) => v.path !== b.path)]);
                  setNotice(`Backup verified: ${b.path}`);
                }
              })
            }
          >
            Create backup…
          </button>
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              void work(async () => {
                await window.acadia!.restoreBackup();
              })
            }
          >
            Restore a checked backup…
          </button>
        </div>
        {backups.length > 0 && (
          <details>
            <summary>Known local backups ({backups.length})</summary>
            <ul>
              {backups.map((b) => (
                <li key={b.path}>
                  {new Date(b.createdAt).toLocaleString()} · {b.files} files ·{" "}
                  {Math.ceil(b.bytes / 1048576)} MB
                  <br />
                  <small>{b.path}</small>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
      <section>
        <h3>Application updates</h3>
        <p>
          Check GitHub only when you choose. Acadia never downloads or installs
          updates automatically. Create a backup before upgrading.
        </p>
        <button
          className="button"
          disabled={busy}
          onClick={() =>
            void work(async () =>
              setUpdate(await window.acadia!.checkForUpdates()),
            )
          }
        >
          Check for updates
        </button>
        {update && (
          <div role="status">
            <p>
              Installed: {update.currentVersion} · Latest stable:{" "}
              {update.latestVersion}
            </p>
            <p>{update.message}</p>
            <button
              className="button quiet"
              onClick={() =>
                void window.acadia!.openExternal(update.releaseUrl)
              }
            >
              Read release notes
            </button>
            {update.available && update.downloadUrl && (
              <button
                className="button quiet"
                onClick={() =>
                  void window.acadia!.openExternal(update.downloadUrl!)
                }
              >
                Open compatible download
              </button>
            )}
          </div>
        )}
      </section>
      <section>
        <h3>Support diagnostics</h3>
        <p>
          Preview the limited application information before saving a support
          file. Nothing is sent automatically.
        </p>
        <button
          className="button"
          disabled={busy}
          onClick={() =>
            void work(async () =>
              setReport(await window.acadia!.diagnosticReport()),
            )
          }
        >
          Preview diagnostics
        </button>
        {report && (
          <>
            <pre
              style={{
                maxHeight: 220,
                overflow: "auto",
                whiteSpace: "pre-wrap",
              }}
            >
              {JSON.stringify(report, null, 2)}
            </pre>
            <button
              className="button"
              disabled={busy}
              onClick={() =>
                void work(async () => {
                  const path = await window.acadia!.exportDiagnostics();
                  if (path) setNotice(`Diagnostics saved: ${path}`);
                })
              }
            >
              Save redacted diagnostics…
            </button>
          </>
        )}
      </section>
      {busy && (
        <p role="status">
          Working… Keep Acadia open until this operation finishes.
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </Modal>
  );
}
