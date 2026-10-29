"use client";

import { useState } from "react";
import Image from "next/image";
import {
  Check,
  Copy,
  ExternalLink,
  FlaskConical,
  HelpCircle,
  QrCode,
  Smartphone,
  Sparkles,
} from "lucide-react";

type Props = {
  orderNumber: string;
  payeeName: string;
  upiId: string;
  amountInr: number;
  upiIntentUri: string;
  dynamicQrDataUrl: string;
  staticQrImagePath?: string;
  isMock?: boolean;
};

export function UpiPaymentBox({
  orderNumber,
  payeeName,
  upiId,
  amountInr,
  upiIntentUri,
  dynamicQrDataUrl,
  staticQrImagePath = "/upi_qr.jpeg",
  isMock = false,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [activeQrTab, setActiveQrTab] = useState<"DYNAMIC" | "STATIC">("DYNAMIC");
  const [showDesktopHelp, setShowDesktopHelp] = useState(false);

  const formattedAmount = amountInr.toFixed(2);

  async function handleCopyUpiId() {
    try {
      await navigator.clipboard.writeText(upiId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback if clipboard API is blocked
      const input = document.createElement("input");
      input.value = upiId;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function handleUpiClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (isMock) {
      e.preventDefault();
      return;
    }
    // On non-mobile browsers, clicking upi:// typically does nothing or triggers an alert.
    // Check if user is on mobile
    const isMobile =
      typeof navigator !== "undefined" &&
      /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent);

    if (!isMobile) {
      // Inform desktop users that UPI links work on mobile devices
      setShowDesktopHelp(true);
    }
  }

  return (
    <div className="space-y-5">
      {/* Preview / Mock Mode Warning Banner */}
      {isMock && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950 shadow-2xs">
          <div className="flex items-start gap-2.5">
            <FlaskConical className="mt-0.5 text-amber-700 shrink-0" size={18} />
            <div className="leading-relaxed">
              <p className="font-bold text-amber-950">
                PREVIEW TEST MODE — 1-CLICK LIVE UPI INTENT DISABLED
              </p>
              <p className="mt-1 text-amber-900">
                You are currently in a test environment. 1-click live UPI transfer has been disabled to prevent accidental payment to the organizer.
              </p>
              <p className="mt-1 font-semibold text-amber-950">
                Use the simulated test controls below to submit a mock test reference (e.g. <code>TEST12345678</code>) and test ticket issuance safely.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Primary Action: Free UPI Intent Launch Button */}
      <div>
        {isMock ? (
          <div className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-amber-300 bg-amber-50/70 p-3.5 text-sm font-semibold text-amber-900 cursor-not-allowed">
            <Smartphone size={18} className="text-amber-700" />
            <span>Pay with any UPI App (Disabled in Preview Mode)</span>
          </div>
        ) : (
          <a
            href={upiIntentUri}
            onClick={handleUpiClick}
            className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-[#7c1619] p-4 text-base font-bold text-white shadow-md transition hover:bg-[#631214] active:scale-[0.99]"
          >
            <Smartphone size={20} className="shrink-0" />
            <span>Pay with any UPI App</span>
            <span className="rounded-md bg-white/20 px-2 py-0.5 text-xs font-mono font-normal">
              ₹{formattedAmount}
            </span>
          </a>
        )}

        <p className="mt-1.5 text-center text-[11px] text-[#705a54]">
          Opens Google Pay, PhonePe, Paytm, BHIM, Cred, or any installed UPI application with amount and order pre-filled.
        </p>

        {showDesktopHelp && (
          <div className="mt-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
            <p className="font-semibold flex items-center gap-1">
              <HelpCircle size={14} />
              <span>Browsing on a PC or laptop?</span>
            </p>
            <p className="mt-0.5 text-blue-800">
              UPI Intent buttons launch apps on Android or iOS mobile devices. To pay from a computer, scan the dynamic QR code below using your mobile phone camera or UPI app.
            </p>
          </div>
        )}
      </div>

      {/* QR Code Presentation Box with Tab Selector */}
      <div className="rounded-2xl border border-[#eadbcf] bg-[#fffaf7] p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#f0e7df] pb-3">
          <div>
            <div className="flex items-center gap-1.5 font-bold text-[#35110f]">
              <QrCode size={18} className="text-[#7c1619]" />
              <span className="text-sm">Scan to Pay</span>
            </div>
            <p className="text-xs text-[#705a54]">
              Point your UPI app or mobile camera to pay instantly
            </p>
          </div>

          {/* QR View Switcher */}
          <div className="flex rounded-xl border border-[#eadbcf] bg-white p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setActiveQrTab("DYNAMIC")}
              className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                activeQrTab === "DYNAMIC"
                  ? "bg-[#7c1619] text-white shadow-2xs"
                  : "text-[#705a54] hover:text-[#7c1619]"
              }`}
            >
              Dynamic Order QR
            </button>
            <button
              type="button"
              onClick={() => setActiveQrTab("STATIC")}
              className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                activeQrTab === "STATIC"
                  ? "bg-[#7c1619] text-white shadow-2xs"
                  : "text-[#705a54] hover:text-[#7c1619]"
              }`}
            >
              Official Organizer QR
            </button>
          </div>
        </div>

        {/* Dynamic Order QR View */}
        {activeQrTab === "DYNAMIC" ? (
          <div className="my-4 flex flex-col items-center justify-center">
            <div className="mb-2 text-center">
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 font-mono text-[10px] font-bold text-emerald-800">
                <Sparkles size={11} />
                <span>Pre-fills ₹{formattedAmount} &amp; Order #{orderNumber}</span>
              </span>
            </div>

            <div className="rounded-2xl border border-[#eadbcf] bg-white p-3 shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={dynamicQrDataUrl}
                alt={`Dynamic UPI QR Code for Order ${orderNumber} - Amount ₹${formattedAmount}`}
                width={260}
                height={260}
                className="h-60 w-60 rounded-xl object-contain"
              />
            </div>

            <div className="mt-3 text-center text-xs text-[#705a54]">
              <p className="font-semibold text-[#35110f]">Amount: ₹{formattedAmount} INR</p>
              <p className="text-[11px] text-[#705a54] mt-0.5">
                Scanning automatically configures payee <b>{payeeName}</b> and exact total <b>₹{formattedAmount}</b>.
              </p>
            </div>
          </div>
        ) : (
          /* Static Organizer QR Fallback */
          <div className="my-4 flex flex-col items-center justify-center">
            <div className="mb-2 text-center">
              <span className="inline-block rounded-full bg-[#7c1619]/10 px-2.5 py-0.5 text-[10px] font-bold text-[#7c1619]">
                Official Organizer Static QR
              </span>
            </div>

            <div className="overflow-hidden rounded-2xl border border-[#eadbcf] bg-white p-2 shadow-sm">
              <Image
                src={staticQrImagePath}
                alt={`Official SSFI UPI QR Code - Payee: ${payeeName}`}
                width={260}
                height={400}
                className="mx-auto h-auto max-w-[240px] rounded-lg object-contain"
                priority
                unoptimized
              />
            </div>

            <div className="mt-3 flex items-center gap-3 text-xs">
              <a
                href={staticQrImagePath}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-[#7c1619] hover:underline"
              >
                <span>Open Full Image</span>
                <ExternalLink size={11} />
              </a>
              <span className="text-[#eadbcf]">·</span>
              <a
                href={staticQrImagePath}
                download="SSFI_UPI_QR.jpeg"
                className="inline-flex items-center gap-1 font-semibold text-[#705a54] hover:underline"
              >
                <span>Download QR</span>
              </a>
            </div>
          </div>
        )}

        {/* Copy UPI ID and Direct VPA Option */}
        <div className="mt-4 border-t border-[#f0e7df] pt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div>
            <span className="text-[#705a54]">Payee UPI ID: </span>
            <span className="font-mono font-bold text-[#7c1619]">{upiId}</span>
          </div>

          <button
            type="button"
            onClick={handleCopyUpiId}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#eadbcf] bg-white px-3 py-1.5 font-semibold text-[#35110f] shadow-2xs hover:bg-[#fffaf7] active:scale-95"
          >
            {copied ? (
              <>
                <Check size={13} className="text-emerald-700" />
                <span className="text-emerald-700 font-bold">Copied!</span>
              </>
            ) : (
              <>
                <Copy size={13} className="text-[#705a54]" />
                <span>Copy UPI ID</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

