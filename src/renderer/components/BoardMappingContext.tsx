import { createContext, useContext, useState } from "react";
import type { BoardReference } from "../../shared/board";

export interface BoardMappingActions {
  addToBoard(reference: BoardReference): Promise<void>;
  openRecord(reference: BoardReference): void;
}
const BoardMappingContext = createContext<BoardMappingActions | undefined>(
  undefined,
);
export const BoardMappingProvider = BoardMappingContext.Provider;
export const useBoardMapping = () => useContext(BoardMappingContext);

/** Hidden outside the editable Collector context, including the released display. */
export function AddToBoardButton({
  reference,
  label = "Add to board",
  disabled = false,
}: {
  reference: BoardReference;
  label?: string;
  disabled?: boolean;
}) {
  const mapping = useBoardMapping();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!mapping) return null;
  return (
    <span className="board-reference-action">
      <button
        type="button"
        className="button quiet"
        disabled={disabled || busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await mapping.addToBoard(reference);
          } catch (error) {
            setError(
              error instanceof Error
                ? error.message
                : "The item could not be added to the board.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Adding…" : label}
      </button>
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
