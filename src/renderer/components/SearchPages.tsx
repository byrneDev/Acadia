import { useState, type ReactNode } from "react";
export function PageNavigation({
  label,
  offset,
  limit,
  total,
  onChange,
}: {
  label: string;
  offset: number;
  limit: number;
  total: number;
  onChange: (offset: number) => void;
}) {
  return (
    <nav aria-label={`${label} pages`} className="search-page-navigation">
      <button
        type="button"
        disabled={offset === 0}
        onClick={() => onChange(Math.max(0, offset - limit))}
      >
        Previous
      </button>
      <span role="status">
        {total ? offset + 1 : 0}–{Math.min(offset + limit, total)} of {total}
      </span>
      <button
        type="button"
        disabled={offset + limit >= total}
        onClick={() => onChange(offset + limit)}
      >
        Next
      </button>
    </nav>
  );
}
export function SearchPages<T>({
  title,
  items,
  render,
}: {
  title: string;
  items: T[];
  render: (item: T) => ReactNode;
}) {
  const [offset, setOffset] = useState(0);
  if (!items.length) return null;
  const page = Math.min(offset, Math.floor((items.length - 1) / 20) * 20);
  return (
    <section aria-label={`${title} search results`}>
      <h3>
        {title} ({items.length})
      </h3>
      {items.slice(page, page + 20).map(render)}
      <PageNavigation
        label={title}
        offset={page}
        limit={20}
        total={items.length}
        onChange={setOffset}
      />
    </section>
  );
}
