"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Loader2, Minus, Plus, ShieldCheck, Ticket } from "lucide-react";
import { createPublicCustomerOrder } from "@/server/actions/publicOrder";

type Props = {
  sellerCode: string;
  sellerName: string;
  unitPricePaise: number;
  remainingCapacity: number;
  isCampaignActive?: boolean;
  campaignStatus?: string;
  scheduleReason?: string;
};

export function PublicOrderForm({
  sellerCode,
  sellerName,
  unitPricePaise,
  remainingCapacity,
  isCampaignActive = true,
  campaignStatus = "ACTIVE",
  scheduleReason,
}: Props) {
  const [quantity, setQuantity] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const maxAllowed = Math.min(remainingCapacity, 100);
  const ticketPriceInr = unitPricePaise / 100;
  const totalAmountInr = quantity * ticketPriceInr;

  function decrement() {
    if (quantity > 1) setQuantity((q) => q - 1);
  }

  function increment() {
    if (quantity < maxAllowed) setQuantity((q) => q + 1);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMsg(null);

    if (!isCampaignActive) {
      setErrorMsg(
        scheduleReason ??
          `Ticket sales are currently not active (campaign status: ${campaignStatus}). Orders cannot be submitted at this time.`
      );
      return;
    }

    setIsSubmitting(true);

    const form = event.currentTarget;
    const formData = new FormData(form);
    formData.set("quantity", String(quantity));
    formData.set("sellerCode", sellerCode);

    try {
      await createPublicCustomerOrder(formData);
    } catch (err: unknown) {
      setIsSubmitting(false);
      if (err instanceof Error) {
        // Next.js redirect() throws a specific NEXT_REDIRECT error which should not be caught as failure
        if (err.message === "NEXT_REDIRECT" || "digest" in err) {
          throw err;
        }
        setErrorMsg(err.message);
      } else {
        setErrorMsg("Failed to place order. Please try again.");
      }
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {!isCampaignActive && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900 shadow-xs">
          <p className="flex items-center gap-1.5 font-bold text-amber-950">
            <AlertTriangle size={15} className="text-amber-700" />
            Ticket Orders Currently Inactive
          </p>
          <p className="mt-1 leading-relaxed text-amber-800">
            This fundraising campaign is in <b>{campaignStatus}</b> status. Online payments and ticket submissions are currently disabled.
          </p>
        </div>
      )}

      {errorMsg && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold">Unable to complete order</p>
          <p className="mt-1">{errorMsg}</p>
        </div>
      )}

      {/* Attribution Card */}
      <div className="flex items-center justify-between rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4 text-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[#705a54]">
            Attributed Seller
          </p>
          <p className="font-bold text-[#7c1619]">{sellerName}</p>
        </div>
        <span className="rounded-full bg-[#fceeee] px-3 py-1 font-mono text-xs font-bold text-[#a41f23]">
          {sellerCode}
        </span>
      </div>

      {/* Customer Info */}
      <div className="space-y-4">
        <div>
          <label htmlFor="customer-name" className="block text-sm font-semibold text-[#35110f]">
            Full Name <span className="text-red-500">*</span>
          </label>
          <input
            id="customer-name"
            name="name"
            type="text"
            autoComplete="name"
            required
            minLength={2}
            maxLength={120}
            placeholder="Your legal full name"
            className="mt-1.5 w-full rounded-xl border border-[#eadbcf] bg-white p-3 text-sm text-[#35110f] shadow-xs focus:border-[#7c1619] focus:outline-hidden"
          />
        </div>

        <div>
          <label htmlFor="customer-whatsapp" className="block text-sm font-semibold text-[#35110f]">
            WhatsApp Number <span className="text-red-500">*</span>
          </label>
          <input
            id="customer-whatsapp"
            name="whatsapp"
            type="tel"
            autoComplete="tel"
            required
            pattern="[0-9+ \-()]{7,25}"
            placeholder="e.g. +91 91234 56789 or international"
            className="mt-1.5 w-full rounded-xl border border-[#eadbcf] bg-white p-3 text-sm text-[#35110f] shadow-xs focus:border-[#7c1619] focus:outline-hidden"
          />
          <p className="mt-1 text-xs text-[#705a54]">
            Must be active on WhatsApp with country calling code. Digital ticket numbers and draw notices are sent here.
          </p>
        </div>

        <div>
          <label htmlFor="customer-email" className="block text-sm font-semibold text-[#35110f]">
            Email Address <span className="text-red-500">*</span>
          </label>
          <input
            id="customer-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="your.email@example.com"
            className="mt-1.5 w-full rounded-xl border border-[#eadbcf] bg-white p-3 text-sm text-[#35110f] shadow-xs focus:border-[#7c1619] focus:outline-hidden"
          />
          <p className="mt-1 text-xs text-[#705a54]">
            Official ticket confirmation and scannable verification link will be emailed immediately upon payment approval.
          </p>
        </div>
      </div>

      {/* Ticket Quantity Selector */}
      <div className="rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Ticket className="text-[#a41f23]" size={18} aria-hidden="true" />
            <span className="text-sm font-bold text-[#35110f]">Number of Tickets</span>
          </div>
          <span className="text-xs text-[#705a54]">₹{ticketPriceInr} each</span>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={decrement}
              disabled={quantity <= 1 || isSubmitting || !isCampaignActive}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#eadbcf] bg-white text-lg font-bold text-[#7c1619] shadow-xs hover:bg-gray-50 disabled:opacity-40"
              aria-label="Decrease quantity"
            >
              <Minus size={16} />
            </button>
            <span className="w-10 text-center font-mono text-xl font-bold text-[#35110f]">
              {quantity}
            </span>
            <button
              type="button"
              onClick={increment}
              disabled={quantity >= maxAllowed || isSubmitting || !isCampaignActive}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#eadbcf] bg-white text-lg font-bold text-[#7c1619] shadow-xs hover:bg-gray-50 disabled:opacity-40"
              aria-label="Increase quantity"
            >
              <Plus size={16} />
            </button>
          </div>

          <div className="text-right">
            <p className="text-xs text-[#705a54]">Total Amount</p>
            <p className="text-2xl font-bold text-[#7c1619]">₹{totalAmountInr}</p>
          </div>
        </div>
      </div>

      {/* Terms & Conditions Agreement Checkbox */}
      <div className="rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4 text-xs text-[#705a54]">
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            name="acceptTerms"
            required
            className="mt-0.5 h-4 w-4 rounded border-[#eadbcf] text-[#7c1619] focus:ring-[#7c1619]"
          />
          <span className="leading-relaxed">
            I have read and agree to the{" "}
            <Link
              href="/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-[#7c1619] underline"
            >
              Payment Instructions and Terms &amp; Conditions
            </Link>
            . I understand that submitting a UTR is pending admin verification before tickets become valid.
          </span>
        </label>
      </div>

      {/* Submit Button */}
      <button
        type="submit"
        disabled={isSubmitting || !isCampaignActive}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#7c1619] p-4 font-bold text-white shadow-md transition hover:bg-[#631214] disabled:cursor-not-allowed disabled:bg-gray-400 disabled:opacity-75"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="animate-spin" size={18} />
            <span>Processing your order...</span>
          </>
        ) : !isCampaignActive ? (
          <>
            <AlertTriangle size={18} />
            <span>Ticket Sales Inactive (Campaign {campaignStatus})</span>
          </>
        ) : (
          <>
            <span>Continue to Payment (₹{totalAmountInr})</span>
            <ArrowRight size={18} />
          </>
        )}
      </button>

      <div className="flex items-center justify-center gap-2 text-xs text-[#705a54]">
        <ShieldCheck size={16} className="text-[#a41f23]" />
        <span>Payments are manually verified by SSFI staff before tickets are issued</span>
      </div>
    </form>
  );
}

