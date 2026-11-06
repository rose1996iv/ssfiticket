import Link from "next/link";
import { ChevronLeft, ChevronRight, Filter, RotateCcw, Search } from "lucide-react";
import type { PaginationWindow } from "@/lib/pagination/serverPagination";

export type FilterOption = {
  value: string;
  label: string;
};

type FilterBarProps = {
  basePath: string;
  searchPlaceholder?: string;
  currentQuery?: string;
  currentStatus?: string;
  statusOptions?: FilterOption[];
  currentSeller?: string;
  sellerOptions?: FilterOption[];
  currentSellerReview?: string;
  sellerReviewOptions?: FilterOption[];
  currentFromDate?: string;
  currentToDate?: string;
  currentPageSize?: number;
};

export function AdminFilterBar({
  basePath,
  searchPlaceholder = "Search by order ref, customer, phone, or UTR...",
  currentQuery = "",
  currentStatus = "",
  statusOptions,
  currentSeller = "",
  sellerOptions,
  currentSellerReview = "",
  sellerReviewOptions,
  currentFromDate = "",
  currentToDate = "",
  currentPageSize = 50,
}: FilterBarProps) {
  return (
    <form
      method="GET"
      action={basePath}
      className="rounded-2xl border border-[#eadbcf] bg-white p-4 shadow-2xs space-y-3"
    >
      <input type="hidden" name="page" value="1" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {/* Search Query */}
        <div className="sm:col-span-2">
          <label className="block text-[10px] font-bold uppercase tracking-wider text-[#705a54]">
            Search
          </label>
          <div className="relative mt-1">
            <input
              type="text"
              name="q"
              defaultValue={currentQuery}
              placeholder={searchPlaceholder}
              className="w-full rounded-xl border border-[#eadbcf] bg-[#fffaf7] py-2 pl-8 pr-3 text-xs text-[#35110f] focus:border-[#7c1619] focus:bg-white focus:outline-hidden"
            />
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-2.5 text-[#705a54]"
            />
          </div>
        </div>

        {/* Status Filter */}
        {statusOptions && statusOptions.length > 0 && (
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-[#705a54]">
              Status Filter
            </label>
            <select
              name="status"
              defaultValue={currentStatus}
              className="mt-1 w-full rounded-xl border border-[#eadbcf] bg-[#fffaf7] px-3 py-2 text-xs text-[#35110f] focus:border-[#7c1619] focus:bg-white focus:outline-hidden"
            >
              {statusOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Seller Filter */}
        {sellerOptions && sellerOptions.length > 0 && (
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-[#705a54]">
              Seller Filter
            </label>
            <select
              name="seller"
              defaultValue={currentSeller}
              className="mt-1 w-full rounded-xl border border-[#eadbcf] bg-[#fffaf7] px-3 py-2 text-xs text-[#35110f] focus:border-[#7c1619] focus:bg-white focus:outline-hidden"
            >
              <option value="">All Sellers</option>
              {sellerOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Seller Advisory Review Filter */}
        {sellerReviewOptions && sellerReviewOptions.length > 0 && (
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-[#705a54]">
              Seller Advisory
            </label>
            <select
              name="sellerReview"
              defaultValue={currentSellerReview}
              className="mt-1 w-full rounded-xl border border-[#eadbcf] bg-[#fffaf7] px-3 py-2 text-xs text-[#35110f] focus:border-[#7c1619] focus:bg-white focus:outline-hidden"
            >
              {sellerReviewOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Date Range & Controls */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-t border-[#f0e7df] pt-3">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-[#705a54]">
              From Date
            </label>
            <input
              type="date"
              name="from"
              defaultValue={currentFromDate}
              className="mt-1 rounded-xl border border-[#eadbcf] bg-[#fffaf7] px-2.5 py-1.5 text-xs text-[#35110f]"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-[#705a54]">
              To Date
            </label>
            <input
              type="date"
              name="to"
              defaultValue={currentToDate}
              className="mt-1 rounded-xl border border-[#eadbcf] bg-[#fffaf7] px-2.5 py-1.5 text-xs text-[#35110f]"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-[#705a54]">
              Rows / Page
            </label>
            <select
              name="pageSize"
              defaultValue={String(currentPageSize)}
              className="mt-1 rounded-xl border border-[#eadbcf] bg-[#fffaf7] px-2.5 py-1.5 text-xs text-[#35110f]"
            >
              <option value="25">25 rows</option>
              <option value="50">50 rows</option>
              <option value="100">100 rows</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={basePath}
            className="inline-flex items-center gap-1 rounded-xl border border-[#eadbcf] bg-white px-3 py-2 text-xs font-bold text-[#705a54] transition hover:bg-[#faf3ee]"
          >
            <RotateCcw size={12} />
            <span>Reset</span>
          </Link>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#7c1619] px-4 py-2 text-xs font-bold text-white shadow-2xs transition hover:bg-[#631214]"
          >
            <Filter size={12} />
            <span>Apply Filters</span>
          </button>
        </div>
      </div>
    </form>
  );
}

export function AdminPaginationFooter({
  basePath,
  pagination,
  queryParams = {},
}: {
  basePath: string;
  pagination: PaginationWindow;
  queryParams?: Record<string, string | undefined>;
}) {
  const buildPageHref = (targetPage: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(queryParams)) {
      if (v && v.trim() !== "") {
        sp.set(k, v);
      }
    }
    sp.set("page", String(targetPage));
    sp.set("pageSize", String(pagination.pageSize));
    return `${basePath}?${sp.toString()}`;
  };

  const startItem = pagination.totalCount === 0 ? 0 : pagination.rangeFrom + 1;
  const endItem = Math.min(pagination.rangeTo + 1, pagination.totalCount);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#eadbcf] bg-white px-5 py-3.5 text-xs text-[#705a54] shadow-2xs">
      <div>
        Showing <strong className="font-mono text-[#35110f]">{startItem}</strong>–
        <strong className="font-mono text-[#35110f]">{endItem}</strong> of{" "}
        <strong className="font-mono text-[#7c1619]">{pagination.totalCount}</strong> total records
        (Page <strong className="font-mono text-[#35110f]">{pagination.page}</strong> of{" "}
        <strong className="font-mono text-[#35110f]">{pagination.totalPages}</strong> · Server-Side
        Paginated, No 200-Row Ceiling)
      </div>

      <div className="flex items-center gap-2">
        {pagination.hasPrevPage ? (
          <Link
            href={buildPageHref(pagination.page - 1)}
            className="inline-flex items-center gap-1 rounded-xl border border-[#eadbcf] bg-[#fffaf7] px-3 py-1.5 font-bold text-[#35110f] transition hover:bg-[#faf3ee]"
          >
            <ChevronLeft size={14} />
            <span>Previous</span>
          </Link>
        ) : (
          <span className="inline-flex cursor-not-allowed items-center gap-1 rounded-xl border border-[#eadbcf]/50 bg-gray-50 px-3 py-1.5 font-semibold text-gray-400">
            <ChevronLeft size={14} />
            <span>Previous</span>
          </span>
        )}

        {pagination.hasNextPage ? (
          <Link
            href={buildPageHref(pagination.page + 1)}
            className="inline-flex items-center gap-1 rounded-xl border border-[#eadbcf] bg-[#fffaf7] px-3 py-1.5 font-bold text-[#35110f] transition hover:bg-[#faf3ee]"
          >
            <span>Next</span>
            <ChevronRight size={14} />
          </Link>
        ) : (
          <span className="inline-flex cursor-not-allowed items-center gap-1 rounded-xl border border-[#eadbcf]/50 bg-gray-50 px-3 py-1.5 font-semibold text-gray-400">
            <span>Next</span>
            <ChevronRight size={14} />
          </span>
        )}
      </div>
    </div>
  );
}

