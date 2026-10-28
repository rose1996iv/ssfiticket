"use client";

import { useState, useRef, useEffect } from "react";
import {
  Download,
  FileSpreadsheet,
  FileText,
  FileType,
  Code,
  ChevronDown,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { ExportFormat, ExportResource } from "@/lib/export/types";

interface ExportDropdownProps {
  resource: ExportResource;
  resourceName?: string;
  status?: string;
  className?: string;
}

interface FormatOption {
  format: ExportFormat;
  label: string;
  sublabel: string;
  icon: typeof FileSpreadsheet;
  badge: string;
  badgeColor: string;
}

const FORMAT_OPTIONS: FormatOption[] = [
  {
    format: "xlsx",
    label: "Excel Workbook",
    sublabel: "Formatted .xlsx with styled headers & auto-widths",
    icon: FileSpreadsheet,
    badge: "XLSX",
    badgeColor: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  {
    format: "csv",
    label: "CSV Spreadsheet",
    sublabel: "UTF-8 BOM with formula-injection protection",
    icon: FileText,
    badge: "CSV",
    badgeColor: "bg-blue-50 text-blue-700 border-blue-200",
  },
  {
    format: "pdf",
    label: "Executive PDF",
    sublabel: "Official SSFI branded document with page headers",
    icon: FileType,
    badge: "PDF",
    badgeColor: "bg-red-50 text-red-700 border-red-200",
  },
  {
    format: "json",
    label: "JSON Feed",
    sublabel: "Structured metadata envelope and audit records",
    icon: Code,
    badge: "JSON",
    badgeColor: "bg-amber-50 text-amber-700 border-amber-200",
  },
];

export function ExportDropdown({
  resource,
  resourceName,
  status,
  className = "",
}: ExportDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [loadingFormat, setLoadingFormat] = useState<ExportFormat | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(
    null
  );
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Clear feedback message after 4 seconds
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 4000);
    return () => clearTimeout(timer);
  }, [feedback]);

  async function handleExport(format: ExportFormat) {
    setLoadingFormat(format);
    setFeedback(null);
    setIsOpen(false);

    try {
      const params = new URLSearchParams({
        resource,
        format,
      });

      if (status) {
        params.append("status", status);
      }

      const response = await fetch(`/api/admin/export?${params.toString()}`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Export failed with status ${response.status}`);
      }

      // Extract filename from Content-Disposition header if available
      let filename = `ssfi-${resource}-${format}.${format}`;
      const disposition = response.headers.get("Content-Disposition");
      if (disposition) {
        const match = disposition.match(/filename=["']?([^"';]+)["']?/i);
        if (match && match[1]) {
          filename = match[1];
        }
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(downloadUrl);

      setFeedback({
        type: "success",
        message: `Successfully downloaded ${filename}`,
      });
    } catch (err: unknown) {
      console.error("[Export Client Error]", err);
      const message = err instanceof Error ? err.message : "Failed to download export file";
      setFeedback({
        type: "error",
        message,
      });
    } finally {
      setLoadingFormat(null);
    }
  }

  const isDownloading = loadingFormat !== null;

  return (
    <div className={`relative inline-block text-left ${className}`} ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => !isDownloading && setIsOpen((prev) => !prev)}
        disabled={isDownloading}
        aria-expanded={isOpen}
        aria-haspopup="true"
        className="inline-flex items-center gap-2 rounded-xl border border-[#eadbcf] bg-white px-3.5 py-2 text-xs font-semibold text-[#35110f] shadow-xs transition hover:border-[#7c1619] hover:bg-[#fffaf7] focus:outline-hidden focus:ring-2 focus:ring-[#7c1619]/20 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isDownloading ? (
          <Loader2 className="animate-spin text-[#7c1619]" size={15} />
        ) : (
          <Download className="text-[#7c1619]" size={15} />
        )}
        <span>{isDownloading ? "Exporting..." : `Export ${resourceName || ""}`}</span>
        <ChevronDown
          size={14}
          className={`text-[#705a54] transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      {/* Floating Feedback Notice */}
      {feedback && (
        <div
          role="status"
          className={`absolute right-0 top-full z-50 mt-2 flex w-72 items-center gap-2 rounded-xl border p-3 text-xs shadow-lg transition-all ${
            feedback.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-950"
              : "border-red-200 bg-red-50 text-red-950"
          }`}
        >
          {feedback.type === "success" ? (
            <CheckCircle2 size={16} className="shrink-0 text-emerald-600" />
          ) : (
            <AlertCircle size={16} className="shrink-0 text-red-600" />
          )}
          <p className="flex-1 font-medium">{feedback.message}</p>
        </div>
      )}

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          role="menu"
          aria-orientation="vertical"
          className="absolute right-0 top-full z-40 mt-2 w-72 origin-top-right rounded-2xl border border-[#eadbcf] bg-white p-2 shadow-xl ring-1 ring-black/5 focus:outline-hidden"
        >
          <div className="border-b border-[#f0e7df] px-3 py-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#705a54]">
              Export Records ({resource})
            </p>
            <p className="mt-0.5 text-[11px] text-[#705a54]">
              Generates all matching records with UTF-8 support
            </p>
          </div>

          <div className="mt-1 space-y-1">
            {FORMAT_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              return (
                <button
                  key={opt.format}
                  type="button"
                  role="menuitem"
                  onClick={() => handleExport(opt.format)}
                  className="flex w-full items-start gap-3 rounded-xl p-2.5 text-left transition hover:bg-[#fffaf7]"
                >
                  <div className="mt-0.5 rounded-lg bg-[#fdf5f2] p-1.5 text-[#7c1619]">
                    <Icon size={16} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-[#35110f]">{opt.label}</span>
                      <span
                        className={`rounded-sm border px-1.5 py-0.2 text-[9px] font-bold uppercase ${opt.badgeColor}`}
                      >
                        {opt.badge}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[10px] leading-tight text-[#705a54]">{opt.sublabel}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
