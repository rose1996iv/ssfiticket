export type PaginationParams = {
  page?: string | number;
  pageSize?: string | number;
};

export type PaginationWindow = {
  page: number;
  pageSize: number;
  rangeFrom: number;
  rangeTo: number;
  totalCount: number;
  totalPages: number;
  hasPrevPage: boolean;
  hasNextPage: boolean;
};

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

/**
 * Computes a server-side PostgREST `.range(rangeFrom, rangeTo)` window without
 * any artificial 100- or 200-record dataset ceiling.
 */
export function computeServerPaginationWindow(
  params: PaginationParams,
  totalCount = 0
): PaginationWindow {
  const rawPage =
    typeof params.page === "number"
      ? params.page
      : typeof params.page === "string"
      ? parseInt(params.page, 10)
      : 1;

  const rawPageSize =
    typeof params.pageSize === "number"
      ? params.pageSize
      : typeof params.pageSize === "string"
      ? parseInt(params.pageSize, 10)
      : DEFAULT_PAGE_SIZE;

  const pageSize =
    Number.isFinite(rawPageSize) && rawPageSize >= 10
      ? Math.min(rawPageSize, MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

  const safeTotal = Math.max(0, totalCount);
  const totalPages = Math.max(1, Math.ceil(safeTotal / pageSize));

  const page =
    Number.isFinite(rawPage) && rawPage >= 1
      ? safeTotal > 0
        ? Math.min(rawPage, totalPages)
        : rawPage
      : 1;

  const rangeFrom = (page - 1) * pageSize;
  const rangeTo = rangeFrom + pageSize - 1;

  return {
    page,
    pageSize,
    rangeFrom,
    rangeTo,
    totalCount: safeTotal,
    totalPages,
    hasPrevPage: page > 1,
    hasNextPage: page < totalPages,
  };
}

