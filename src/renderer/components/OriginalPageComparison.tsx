import { useEffect, useState } from "react";
import type { Passage } from "../../shared/research";
import { Modal } from "./Dialogs";
export function OriginalPageComparison({
  passage,
  sourceTitle,
  onClose,
}: {
  passage: Passage;
  sourceTitle: string;
  onClose: () => void;
}) {
  const [page, setPage] = useState(passage.page || 1);
  const [preview, setPreview] = useState<{
    dataUrl: string;
    page: number;
    totalPages: number;
  }>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    void window
      .acadia!.getSourcePagePreview(passage.sourceId, passage.versionId, page)
      .then((value) => {
        if (alive) {
          setPreview(value);
          setLoading(false);
        }
      })
      .catch(() => {
        if (alive) {
          setLoading(false);
          setError(
            "The original PDF page could not be rendered. The saved passage is unchanged. Retry or open the original file from the reader.",
          );
        }
      });
    return () => {
      alive = false;
    };
  }, [passage.sourceId, passage.versionId, page, retry]);
  return (
    <Modal
      title="Compare with original page"
      subtitle={`${sourceTitle} · saved source version`}
      wide
      onClose={onClose}
    >
      <div className="original-page-comparison">
        <section aria-label="Original PDF page" aria-busy={loading}>
          <nav
            className="search-page-navigation"
            aria-label="Original PDF pages"
          >
            <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous page
            </button>
            <span role="status">
              Page {page}
              {preview ? ` of ${preview.totalPages}` : ""}
            </span>
            <button
              disabled={!preview || page >= preview.totalPages}
              onClick={() => setPage(page + 1)}
            >
              Next page
            </button>
          </nav>
          {error ? (
            <>
              <p role="alert">{error}</p>
              <button onClick={() => setRetry((v) => v + 1)}>
                Retry page preview
              </button>
            </>
          ) : loading ? (
            <p role="status">Rendering the saved original page…</p>
          ) : (
            preview && (
              <img
                src={preview.dataUrl}
                alt={`Original PDF page ${preview.page}. The selected extracted passage is ${passage.locator}.`}
              />
            )
          )}
        </section>
        <section aria-label="Extracted passage for comparison">
          <h3>{passage.locator}</h3>
          {page !== passage.page && (
            <p>
              Browsing original page {page}; the selected passage remains{" "}
              {passage.locator}.
            </p>
          )}
          <p>
            {passage.method === "ocr"
              ? "OCR text — compare wording, figures and omissions against the image."
              : "Native extracted text — compare its context against the original."}
          </p>
          <blockquote>{passage.text}</blockquote>
          <p>
            This view uses the original attached to this historical version. It
            does not change evidence or acceptance.
          </p>
        </section>
      </div>
    </Modal>
  );
}
