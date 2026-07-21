import { useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Loader2, Search } from "lucide-react";

/** Substring match (case-insensitive) across every global-filterable column. Mirrors the
 * ad-hoc `haystack.includes(query)` search pattern every admin page used to hand-roll. */
function textIncludesFilter(row, columnId, filterValue) {
  const value = row.getValue(columnId);
  if (value == null) return false;
  return String(value).toLowerCase().includes(String(filterValue).toLowerCase());
}

function ColumnFilter({ column }) {
  const meta = column.columnDef.meta || {};
  if (!meta.filterVariant) return null;
  const value = column.getFilterValue() ?? "";

  if (meta.filterVariant === "select") {
    return (
      <select
        value={value}
        onChange={(event) => column.setFilterValue(event.target.value || undefined)}
        onClick={(event) => event.stopPropagation()}
        className="mt-1 w-full rounded border border-zinc-200 bg-white px-1.5 py-1 text-xs font-normal text-zinc-600 outline-none focus:ring-1 focus:ring-violet-300"
      >
        <option value="">All</option>
        {(meta.filterOptions || []).map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    );
  }

  return (
    <input
      type="text"
      value={value}
      onChange={(event) => column.setFilterValue(event.target.value || undefined)}
      onClick={(event) => event.stopPropagation()}
      placeholder="Filter…"
      className="mt-1 w-full rounded border border-zinc-200 bg-white px-1.5 py-1 text-xs font-normal text-zinc-600 outline-none focus:ring-1 focus:ring-violet-300"
    />
  );
}

/**
 * Shared admin-panel table: global search, per-column filters, sortable headers,
 * and pagination, built on @tanstack/react-table. Callers only provide column
 * defs + row data; this owns all table interaction state.
 */
export default function AdminDataTable({
  columns,
  data,
  loading = false,
  error = "",
  emptyMessage = "No results found.",
  searchPlaceholder = "Search…",
  getRowId,
  initialSorting = [],
  initialPageSize = 25,
  pageSizeOptions = [10, 25, 50, 100],
  toolbarExtra = null,
}) {
  const [globalFilter, setGlobalFilter] = useState("");
  const [sorting, setSorting] = useState(initialSorting);
  const [columnFilters, setColumnFilters] = useState([]);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: initialPageSize });

  const rows = useMemo(() => data || [], [data]);

  const table = useReactTable({
    data: rows,
    columns,
    state: { globalFilter, sorting, columnFilters, pagination },
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onPaginationChange: setPagination,
    globalFilterFn: textIncludesFilter,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const filteredCount = table.getFilteredRowModel().rows.length;
  const pageCount = table.getPageCount();
  const columnCount = columns.length;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            value={globalFilter}
            onChange={(event) => setGlobalFilter(event.target.value)}
            placeholder={searchPlaceholder}
            className="w-full rounded-lg border border-zinc-200 py-2 pl-9 pr-3 text-sm outline-none ring-violet-200 focus:ring-2"
          />
        </div>
        {toolbarExtra}
        <p className="text-xs text-zinc-500 sm:ml-auto">{filteredCount} row(s) shown</p>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>
      ) : null}

      <div className="max-w-full overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const sortState = header.column.getIsSorted();
                  const canSort = header.column.getCanSort();
                  return (
                    <th key={header.id} className="px-4 py-3 align-top">
                      {header.isPlaceholder ? null : (
                        <>
                          <button
                            type="button"
                            disabled={!canSort}
                            onClick={header.column.getToggleSortingHandler()}
                            className={`inline-flex items-center gap-1 ${canSort ? "cursor-pointer hover:text-zinc-700" : "cursor-default"}`}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {canSort ? (
                              sortState === "asc" ? (
                                <ArrowUp className="h-3 w-3" />
                              ) : sortState === "desc" ? (
                                <ArrowDown className="h-3 w-3" />
                              ) : (
                                <ArrowUpDown className="h-3 w-3 opacity-40" />
                              )
                            ) : null}
                          </button>
                          <ColumnFilter column={header.column} />
                        </>
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {loading ? (
              <tr><td className="px-4 py-8 text-center text-zinc-500" colSpan={columnCount}><Loader2 className="mx-auto h-5 w-5 animate-spin" /></td></tr>
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="hover:bg-zinc-50">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr><td className="px-4 py-8 text-center text-zinc-500" colSpan={columnCount}>{emptyMessage}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {!loading && filteredCount > 0 ? (
        <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span>Rows per page</span>
            <select
              value={pagination.pageSize}
              onChange={(event) => table.setPageSize(Number(event.target.value))}
              className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-600 outline-none focus:ring-1 focus:ring-violet-300"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <span>Page {pageCount ? pagination.pageIndex + 1 : 0} of {pageCount}</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
                className="inline-flex items-center justify-center rounded border border-zinc-200 p-1.5 text-zinc-600 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
                className="inline-flex items-center justify-center rounded border border-zinc-200 p-1.5 text-zinc-600 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
