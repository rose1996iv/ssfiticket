"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";

export function PaymentScreenshotField({ onChange }: { onChange: (file: File | null) => void }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const select = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (preview) URL.revokeObjectURL(preview);
    if (!file) { setPreview(null); onChange(null); return; }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024) {
      setError("Choose a JPEG, PNG, or WebP image no larger than 2 MB.");
      setPreview(null);
      onChange(null);
      event.target.value = "";
      return;
    }
    setError(null);
    setPreview(URL.createObjectURL(file));
    onChange(file);
  };

  const handleRemove = () => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setError(null);
    onChange(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4">
      <label htmlFor="payment-screenshot" className="block text-xs font-semibold uppercase tracking-wider text-[#705a54]">
        5. Payment Screenshot <span className="text-red-500">*</span>
      </label>
      <p className="mt-1 text-[11px] text-[#705a54]">
        JPEG, PNG, or WebP only; maximum 2 MB. This supports review and is not payment confirmation.
      </p>
      <input
        ref={fileInputRef}
        id="payment-screenshot"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        required
        onChange={select}
        className="mt-3 block w-full text-xs text-[#705a54] file:mr-3 file:rounded-lg file:border-0 file:bg-[#7c1619] file:px-3 file:py-2 file:text-xs file:font-bold file:text-white"
      />
      {error && <p role="alert" className="mt-2 text-xs font-semibold text-red-600">{error}</p>}
      {preview && (
        <div className="relative mt-3 max-w-xs">
          {/* Blob URLs cannot be optimized by next/image. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Selected payment screenshot preview" className="max-h-48 rounded-lg border border-[#eadbcf]" />
          <button
            type="button"
            onClick={handleRemove}
            className="absolute right-1 top-1 rounded-full bg-white p-1 text-[#7c1619] shadow-xs"
            aria-label="Remove screenshot"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {!preview && <ImagePlus size={18} className="mt-2 text-[#7c1619]" />}
    </div>
  );
}
