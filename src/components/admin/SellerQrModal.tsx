"use client";

import { useState } from "react";
import QRCode from "qrcode";
import { Copy, Check, Download, QrCode, X, ExternalLink } from "lucide-react";

type Props = {
  sellerCode: string;
  sellerName: string;
  isActive: boolean;
};

export function SellerQrModal({ sellerCode, sellerName, isActive }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const referralUrl = `${baseUrl}/buy?ref=${encodeURIComponent(sellerCode)}`;

  async function handleOpen() {
    setIsOpen(true);
    if (!qrDataUrl) {
      try {
        const url = await QRCode.toDataURL(referralUrl, {
          width: 500,
          margin: 2,
          color: {
            dark: "#7c1619", // SSFI Primary Maroon
            light: "#ffffff",
          },
          errorCorrectionLevel: "H",
        });
        setQrDataUrl(url);
      } catch (err) {
        console.error("Failed to generate QR code", err);
      }
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(referralUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[#eadbcf] bg-[#fffaf7] px-3 py-1.5 text-xs font-semibold text-[#7c1619] transition hover:bg-[#f8e9df]"
        title="View & Download QR Code"
      >
        <QrCode size={14} aria-hidden="true" />
        <span>QR Code</span>
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
        >
          <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="absolute right-4 top-4 rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              aria-label="Close"
            >
              <X size={20} />
            </button>

            <div className="text-center">
              <span className="inline-block rounded-full bg-[#fceeee] px-3 py-1 text-xs font-bold text-[#a41f23]">
                {sellerCode}
              </span>
              <h2 className="mt-2 text-xl font-bold text-[#35110f]">{sellerName}</h2>
              <p className="text-xs text-[#705a54]">
                {isActive ? "Active Seller Referral QR" : "Inactive Seller — Referral links will be rejected"}
              </p>
            </div>

            <div className="my-5 flex flex-col items-center justify-center rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4">
              {qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrDataUrl}
                  alt={`QR code for ${sellerName}`}
                  className="h-56 w-56 rounded-lg bg-white p-2 shadow-sm"
                />
              ) : (
                <div className="flex h-56 w-56 items-center justify-center text-sm text-gray-400">
                  Generating QR...
                </div>
              )}
              <p className="mt-2 text-center text-xs text-[#705a54]">
                Scan to buy tickets under this seller
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[#705a54]">Referral URL</label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={referralUrl}
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-mono text-gray-700 select-all"
                  />
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-[#7c1619] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#631214]"
                    title="Copy Link"
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    <span>{copied ? "Copied" : "Copy"}</span>
                  </button>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                {qrDataUrl && (
                  <a
                    href={qrDataUrl}
                    download={`qr-${sellerCode.toLowerCase()}.png`}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#d6a23b] px-4 py-2.5 text-xs font-bold text-[#35110f] transition hover:bg-[#c29130]"
                  >
                    <Download size={14} />
                    <span>Download PNG</span>
                  </a>
                )}
                <a
                  href={referralUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                  title="Open in new tab"
                >
                  <ExternalLink size={14} />
                  <span>Preview</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
