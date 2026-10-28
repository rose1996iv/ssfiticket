"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, Download, QrCode } from "lucide-react";

type Props = {
  sellerCode: string;
  sellerName: string;
};

export function SellerReferralCard({ sellerCode, sellerName }: Props) {
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const referralUrl = `${baseUrl}/buy?ref=${encodeURIComponent(sellerCode)}`;

  useEffect(() => {
    QRCode.toDataURL(referralUrl, {
      width: 400,
      margin: 2,
      color: {
        dark: "#7c1619",
        light: "#ffffff",
      },
      errorCorrectionLevel: "H",
    })
      .then(setQrDataUrl)
      .catch((err) => console.error("QR generation failed", err));
  }, [referralUrl]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(referralUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  return (
    <div className="rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-sm">
      <div className="flex items-center gap-2 text-[#7c1619]">
        <QrCode size={20} aria-hidden="true" />
        <h2 className="text-lg font-bold">Your Referral Link & QR Code</h2>
      </div>
      <p className="mt-1 text-sm text-[#705a54]">
        Customers can scan your QR code or use your link to place ticket orders directly attributed to you.
      </p>

      <div className="mt-5 grid items-center gap-6 sm:grid-cols-[160px_1fr]">
        <div className="flex flex-col items-center justify-center rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-3">
          {qrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qrDataUrl}
              alt={`QR code for ${sellerName}`}
              className="h-36 w-36 rounded-lg bg-white p-1.5 shadow-xs"
            />
          ) : (
            <div className="flex h-36 w-36 items-center justify-center text-xs text-gray-400">
              Generating...
            </div>
          )}
          <span className="mt-1.5 text-[11px] font-mono font-bold text-[#a41f23]">{sellerCode}</span>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-[#705a54]">
              Public Referral Link
            </label>
            <div className="mt-1.5 flex gap-2">
              <input
                type="text"
                readOnly
                value={referralUrl}
                className="w-full rounded-lg border border-[#eadbcf] bg-[#fffaf7] px-3 py-2 text-xs font-mono text-[#35110f] select-all"
              />
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#7c1619] px-3.5 py-2 text-xs font-bold text-white transition hover:bg-[#631214]"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                <span>{copied ? "Copied" : "Copy Link"}</span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            {qrDataUrl && (
              <a
                href={qrDataUrl}
                download={`qr-${sellerCode.toLowerCase()}.png`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#d6a23b] px-4 py-2 text-xs font-bold text-[#35110f] transition hover:bg-[#c29130]"
              >
                <Download size={14} />
                <span>Download QR Code Image</span>
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

