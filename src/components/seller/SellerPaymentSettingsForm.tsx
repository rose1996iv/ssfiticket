"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  QrCode,
  RefreshCw,
  Save,
  ShieldCheck,
  Upload,
} from "lucide-react";
import {
  uploadSellerPaymentQr,
  updateSellerPaymentDetails,
  createSellerOwnQrSignedUrl,
} from "@/server/actions/sellerPaymentSettings";

type Props = {
  sellerCode: string;
  displayName: string;
  initialUpiId?: string | null;
  initialAccountName?: string | null;
  initialPaymentInstructions?: string | null;
  initialIsQrActive: boolean;
  hasQrImage: boolean;
};

export function SellerPaymentSettingsForm({
  sellerCode,
  displayName,
  initialUpiId = "",
  initialAccountName = "",
  initialPaymentInstructions = "",
  initialIsQrActive = false,
  hasQrImage = false,
}: Props) {
  const [upiId, setUpiId] = useState(initialUpiId || "");
  const [accountName, setAccountName] = useState(initialAccountName || "");
  const [paymentInstructions, setPaymentInstructions] = useState(
    initialPaymentInstructions || ""
  );
  const [isQrActive, setIsQrActive] = useState(initialIsQrActive);
  const [hasQr, setHasQr] = useState(hasQrImage);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [statusMessage, setStatusMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const [isUploading, startUploadTransition] = useTransition();
  const [isSaving, startSaveTransition] = useTransition();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      setStatusMessage(null);
    }
  };

  const handleUploadQr = () => {
    if (!selectedFile) return;
    setStatusMessage(null);

    startUploadTransition(async () => {
      const formData = new FormData();
      formData.append("qrFile", selectedFile);

      const res = await uploadSellerPaymentQr(formData);
      if (res.success) {
        setHasQr(true);
        setIsQrActive(false);
        setStatusMessage({
          type: "success",
          text: "Payment QR code uploaded successfully! It is now pending review and activation by an SSFI Administrator.",
        });
        setSelectedFile(null);
      } else {
        setStatusMessage({
          type: "error",
          text: res.error || "Failed to upload QR code. Please try again.",
        });
      }
    });
  };

  const handleSaveDetails = (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMessage(null);

    startSaveTransition(async () => {
      const formData = new FormData();
      formData.append("upiId", upiId);
      formData.append("accountName", accountName);
      formData.append("paymentInstructions", paymentInstructions);
      formData.append("isQrActive", isQrActive ? "true" : "false");

      const res = await updateSellerPaymentDetails(formData);
      if (res.success) {
        setStatusMessage({
          type: "success",
          text: "Payment settings saved successfully.",
        });
      } else {
        setStatusMessage({
          type: "error",
          text: res.error || "Failed to save settings. Please try again.",
        });
      }
    });
  };

  const handleLoadExistingPreview = async () => {
    setStatusMessage(null);
    const res = await createSellerOwnQrSignedUrl();
    if (res.success && res.url) {
      setPreviewUrl(res.url);
    } else {
      setStatusMessage({
        type: "error",
        text: res.error || "Unable to load existing QR preview.",
      });
    }
  };

  return (
    <div className="space-y-8">
      {statusMessage && (
        <div
          className={`flex items-start gap-3 rounded-xl border p-4 text-sm ${
            statusMessage.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-red-200 bg-red-50 text-red-900"
          }`}
        >
          {statusMessage.type === "success" ? (
            <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" />
          ) : (
            <AlertCircle size={18} className="mt-0.5 shrink-0 text-red-600" />
          )}
          <span>{statusMessage.text}</span>
        </div>
      )}

      {/* QR Upload & Preview Section */}
      <div className="rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-center gap-3 border-b border-[#f0e7df] pb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#fceeee] text-[#7c1619]">
            <QrCode size={20} />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#35110f]">
              Personal UPI Payment QR
            </h2>
            <p className="text-xs text-[#705a54]">
              Upload your own UPI payment QR code (PhonePe, Google Pay, Paytm, BHIM)
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-6 sm:grid-cols-2 sm:items-start">
          {/* File Picker & Upload Action */}
          <div className="space-y-4">
            <label className="block text-xs font-bold uppercase tracking-wider text-[#705a54]">
              Choose QR Image
            </label>
            <div className="rounded-xl border border-dashed border-[#d8c3b4] bg-[#fffaf7] p-5 text-center transition hover:bg-[#fff5ee]">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleFileChange}
                className="hidden"
                id="seller-qr-upload"
              />
              <label
                htmlFor="seller-qr-upload"
                className="inline-flex cursor-pointer flex-col items-center gap-2"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-xs text-[#7c1619]">
                  <Upload size={18} />
                </div>
                <span className="text-xs font-semibold text-[#7c1619]">
                  {selectedFile ? selectedFile.name : "Select JPEG, PNG, or WebP"}
                </span>
                <span className="text-[11px] text-[#9c847e]">
                  Maximum image size: 2 MB
                </span>
              </label>
            </div>

            {selectedFile && (
              <button
                type="button"
                onClick={handleUploadQr}
                disabled={isUploading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#7c1619] py-2.5 text-xs font-bold text-white shadow-xs transition hover:bg-[#631214] disabled:opacity-50"
              >
                {isUploading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Uploading QR...</span>
                  </>
                ) : (
                  <>
                    <Upload size={14} />
                    <span>Confirm &amp; Save QR Image</span>
                  </>
                )}
              </button>
            )}

            {hasQr && !selectedFile && (
              <button
                type="button"
                onClick={handleLoadExistingPreview}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#7c1619] hover:underline"
              >
                <RefreshCw size={13} />
                <span>View Current Saved QR</span>
              </button>
            )}
          </div>

          {/* QR Preview Display */}
          <div className="flex flex-col items-center justify-center rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-5">
            <span className="mb-3 text-[11px] font-bold uppercase tracking-wider text-[#705a54]">
              QR Code Preview
            </span>
            {previewUrl ? (
              <div className="relative h-56 w-56 overflow-hidden rounded-xl border border-white bg-white p-2 shadow-xs">
                <Image
                  src={previewUrl}
                  alt="Seller Payment QR Preview"
                  fill
                  className="object-contain"
                  unoptimized
                />
              </div>
            ) : hasQr ? (
              <div className="flex h-56 w-56 flex-col items-center justify-center rounded-xl border border-[#eadbcf] bg-white p-4 text-center">
                {isQrActive ? (
                  <>
                    <ShieldCheck size={32} className="text-emerald-600 mb-2" />
                    <span className="text-xs font-bold text-emerald-800">
                      Active QR on File
                    </span>
                    <span className="mt-1 text-[11px] text-[#705a54]">
                      Accepting live customer orders
                    </span>
                  </>
                ) : (
                  <>
                    <AlertCircle size={32} className="text-amber-600 mb-2" />
                    <span className="text-xs font-bold text-amber-800">
                      Pending Admin Activation
                    </span>
                    <span className="mt-1 text-[11px] text-[#705a54]">
                      Awaiting Administrator verification
                    </span>
                  </>
                )}
                <span className="mt-2 text-[10px] text-[#9c847e]">
                  Tap &quot;View Current Saved QR&quot; to preview
                </span>
              </div>
            ) : (
              <div className="flex h-56 w-56 flex-col items-center justify-center rounded-xl border border-dashed border-[#eadbcf] bg-white/50 p-4 text-center">
                <QrCode size={32} className="text-[#cbb5a7] mb-2" />
                <span className="text-xs text-[#9c847e]">
                  No QR image uploaded yet
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Account Details & Instructions Form */}
      <form
        onSubmit={handleSaveDetails}
        className="rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-sm sm:p-8"
      >
        <div className="flex items-center gap-3 border-b border-[#f0e7df] pb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#fceeee] text-[#7c1619]">
            <Save size={20} />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#35110f]">
              Payment Destination Details
            </h2>
            <p className="text-xs text-[#705a54]">
              Information displayed to buyers when paying for tickets assigned to you
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-5">
          {/* UPI ID */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[#705a54]">
              Your UPI ID (VPA)
            </label>
            <input
              type="text"
              value={upiId}
              onChange={(e) => setUpiId(e.target.value)}
              placeholder="e.g. yourname@okaxis, 9876543210@paytm"
              className="mt-1.5 w-full rounded-xl border border-[#eadbcf] bg-[#fffaf7] px-3.5 py-2.5 text-xs text-[#35110f] focus:border-[#7c1619] focus:outline-none focus:ring-1 focus:ring-[#7c1619]"
            />
            <p className="mt-1 text-[11px] text-[#9c847e]">
              Customers will see this ID alongside your QR code for copy-paste.
            </p>
          </div>

          {/* Account Holder Name */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[#705a54]">
              Account Holder / Payee Name
            </label>
            <input
              type="text"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              placeholder={`e.g. ${displayName}`}
              className="mt-1.5 w-full rounded-xl border border-[#eadbcf] bg-[#fffaf7] px-3.5 py-2.5 text-xs text-[#35110f] focus:border-[#7c1619] focus:outline-none focus:ring-1 focus:ring-[#7c1619]"
            />
            <p className="mt-1 text-[11px] text-[#9c847e]">
              Displayed to customer to confirm they are paying the right person.
            </p>
          </div>

          {/* Payment Instructions */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-[#705a54]">
              Special Payment Instructions (Optional)
            </label>
            <textarea
              rows={3}
              value={paymentInstructions}
              onChange={(e) => setPaymentInstructions(e.target.value)}
              placeholder="e.g. Please put your name or Order Number in the UPI payment note."
              className="mt-1.5 w-full rounded-xl border border-[#eadbcf] bg-[#fffaf7] px-3.5 py-2.5 text-xs text-[#35110f] focus:border-[#7c1619] focus:outline-none focus:ring-1 focus:ring-[#7c1619]"
            />
          </div>

          {/* QR Activation Status */}
          <div className="rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={isQrActive}
                onChange={(e) => {
                  if (isQrActive && !e.target.checked) {
                    setIsQrActive(false);
                  }
                }}
                disabled={!isQrActive}
                className="mt-0.5 h-4 w-4 rounded border-[#eadbcf] text-[#7c1619] focus:ring-[#7c1619] disabled:opacity-50"
              />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-[#35110f]">
                    Personal QR Order Acceptance
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      isQrActive
                        ? "bg-emerald-100 text-emerald-800"
                        : hasQr
                        ? "bg-amber-100 text-amber-800"
                        : "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {isQrActive ? "Active" : hasQr ? "Pending Admin Approval" : "Inactive"}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-[#705a54]">
                  {isQrActive
                    ? `Your personal QR is actively shown on customer orders for referral code ${sellerCode}. Uncheck to temporarily pause customer orders.`
                    : hasQr
                    ? "Your personal QR and payment details are awaiting Administrator verification and activation."
                    : "Upload your personal payment QR image above and save your UPI ID to request Administrator activation."}
                </p>
              </div>
            </div>
          </div>

          {/* Submit Button */}
          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex items-center gap-2 rounded-xl bg-[#7c1619] px-6 py-2.5 text-xs font-bold text-white shadow-xs transition hover:bg-[#631214] disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Saving Settings...</span>
                </>
              ) : (
                <>
                  <Save size={14} />
                  <span>Save Payment Details</span>
                </>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

