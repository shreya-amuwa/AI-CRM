import React, { useEffect, useState } from 'react';
import { Pager } from '../team-member/pipeline/shared';
import { FEED_PAGE_SIZE, pageOf } from '../../lib/paging';

export { FEED_PAGE_SIZE };

/**
 * Feed-style lists (recent activity, history, timelines, notes, logs) show one page at a time instead of growing the page:
 * the newest entries first (the lists already arrive newest first), the CRM's usual page buttons below, and no buttons at all
 * when everything fits on one page.
 *
 *   <Paged items={d.history} noun="entries">{rows => <ul>{rows.map(...)}</ul>}</Paged>
 *
 * A render function (not a hook) so it also works for a list inside another list's .map().
 */
export function Paged<T>({
  items,
  pageSize = FEED_PAGE_SIZE,
  noun = 'entries',
  children
}: {
  items: readonly T[] | null | undefined;
  pageSize?: number;
  noun?: string;
  children: (rows: T[]) => React.ReactNode;
}): React.ReactElement {
  const list = items ?? [];
  const [page, setPage] = useState(1);
  const view = pageOf(list, page, pageSize);
  // The list shrank (a filter, a reload): stay on a page that exists.
  useEffect(() => {
    if (view.page !== page) setPage(view.page);
  }, [view.page, page]);
  return (
    <>
      {children(view.rows)}
      {view.pages > 1 && <Pager page={view.page} pageSize={pageSize} total={list.length} noun={noun} onPage={setPage} />}
    </>
  );
}
