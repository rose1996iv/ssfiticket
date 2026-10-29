"use client";

import { useState } from "react";
import { AlertTriangle, ArrowRight, Loader2, Mail, Minus, Phone, Plus, ShieldCheck, Ticket, User } from "lucide-react";
import { createSale } from "@/server/actions/operations";

type Props = {
  sellerName: string;
  sellerCode: string;
  unitPricePaise: number;
  remainingCapacity: number;
  isCampaignActive?: boolean;
  campaignStatus?: string;
  scheduleReason?: string;
};

export function SellerOrderForm({
  sellerName,
  sellerCode,
  unitPricePaise,
  remainingCapacity,
  isCampaignActive = true,
  campaignStatus = "ACTIVE",
  scheduleReason,
}: Props) {
  const [quantity, setQuantity] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const maxAllowed = Math.min(Math.max(1, remainingCapacity), 1000);
  const ticketPriceInr = unitPricePaise / 100;
  const totalAmountInr = quantity * ticketPriceInr;

  function decrement() {
    if (quantity > 1) setQuantity((q) => q - 1);
  }

  function increment() {
    if (quantity < maxAllowed) setQuantity((q) => q + 1);
  }

  function handleQuantityChange(value: number) {
    if (isNaN(value)) return;
    const clamped = Math.max(1, Math.min(value, maxAllowed));
    setQuantity(clamped);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMsg(null);

    if (!isCampaignActive) {
      setErrorMsg(
        scheduleReason ??
          `Ticket sales are currently not active (campaign status: ${campaignStatus}). Seller manual orders cannot be submitted at this time.`
      );
      return;
    }

    setIsSubmitting(true);

    const form = event.currentTarget;
    const formData = new FormData(form);
    formData.set("quantity", String(quantity));

    try {
      await createSale(formData);
    } catch (err: unknown) {
      setIsSubmitting(false);
      if (err instanceof Error) {
        // Next.js redirect() throws a specific NEXT_REDIRECT error which must bubble up
        if (err.message === "NEXT_REDIRECT" || "digest" in err) {
          throw err;
        }
        setErrorMsg(err.message);
      } else {
        setErrorMsg("Failed to create sale. Please try again.");
      }
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {!isCampaignActive && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900 shadow-xs">
          <p className="flex items-center gap-1.5 font-bold text-amber-950">
            <AlertTriangle size={16} className="text-amber-700 shrink-0" />
            Ticket Sales Currently Inactive ({campaignStatus})
          </p>
          <p className="mt-1 leading-relaxed text-amber-800">
            {scheduleReason ??
              `This fundraising campaign is in ${campaignStatus} status. Manual order entry and ticket issuances are temporarily disabled until administrators officially activate the campaign.`}
          </p>
        </div>
      )}

      {errorMsg && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="flex items-center gap-1.5 font-semibold text-red-950">
            <AlertTriangle size={16} className="text-red-700 shrink-0" />
            Unable to complete sale
          </p>
          <p className="mt-1">{errorMsg}</p>
        </div>
      )}

      {/* Seller Attribution Card */}
      <div className="flex items-center justify-between rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4 text-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[#705a54]">
            Attributed Seller
          </p>
          <p className="font-bold text-[#7c1619]">{sellerName}</p>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#705a54]">
            Seller Code
          </p>
          <span className="inline-block mt-0.5 rounded-md bg-[#fceeee] px-2.5 py-0.5 font-mono text-xs font-bold text-[#a41f23]">
            {sellerCode}
          </span>
        </div>
      </div>

      {/* Customer Info */}
      <div className="space-y-4 rounded-xl border border-[#eadbcf] bg-white p-5 shadow-xs">
        <h3 className="font-bold text-[#35110f] text-sm flex items-center gap-2">
          <User size={16} className="text-[#7c1619]" />
          Customer Information
        </h3>

        <div>
          <label htmlFor="customer-name" className="block text-xs font-semibold text-[#35110f]">
            Full Name <span className="text-red-500">*</span>
          </label>
          <input
            id="customer-name"
            name="name"
            required
            disabled={isSubmitting || !isCampaignActive}
            minLength={2}
            maxLength={120}
            placeholder="e.g. Ramesh Kumar"
            className="mt-1.5 w-full rounded-lg border border-[#eadbcf] bg-white p-2.5 text-sm text-[#35110f] shadow-2xs focus:border-[#7c1619] focus:outline-hidden disabled:bg-gray-100 disabled:cursor-not-allowed"
          />
        </div>

        <div>
          <label htmlFor="customer-whatsapp" className="block text-xs font-semibold text-[#35110f]">
            <span className="flex items-center gap-1.5">
              <Phone size={13} className="text-[#705a54]" />
              Phone / WhatsApp Number <span className="text-red-500">*</span>
            </span>
          </label>
          <input
            id="customer-whatsapp"
            name="whatsapp"
            type="tel"
            required
            disabled={isSubmitting || !isCampaignActive}
            pattern="[0-9+ -]{7,20}"
            placeholder="e.g. +91 91234 56789"
            className="mt-1.5 w-full rounded-lg border border-[#eadbcf] bg-white p-2.5 text-sm text-[#35110f] shadow-2xs focus:border-[#7c1619] focus:outline-hidden disabled:bg-gray-100 disabled:cursor-not-allowed"
          />
          <p className="mt-1 text-xs text-[#705a54]">
            Official draw notifications and digital ticket numbers are sent here.
          </p>
        </div>

        <div>
          <label htmlFor="customer-email" className="block text-xs font-semibold text-[#35110f]">
            <span className="flex items-center gap-1.5">
              <Mail size={13} className="text-[#705a54]" />
              Email Address <span className="font-normal text-[#705a54]">(Optional)</span>
            </span>
          </label>
          <input
            id="customer-email"
            name="email"
            type="email"
            disabled={isSubmitting || !isCampaignActive}
            placeholder="customer@example.com"
            className="mt-1.5 w-full rounded-lg border border-[#eadbcf] bg-white p-2.5 text-sm text-[#35110f] shadow-2xs focus:border-[#7c1619] focus:outline-hidden disabled:bg-gray-100 disabled:cursor-not-allowed"
          />
        </div>
      </div>

      {/* Ticket Quantity & Pricing */}
      <div className="rounded-xl border border-[#eadbcf] bg-white p-5 shadow-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Ticket className="text-[#a41f23]" size={18} aria-hidden="true" />
            <span className="text-sm font-bold text-[#35110f]">Ticket Quantity</span>
          </div>
          <span className="text-xs font-medium text-[#705a54]">₹{ticketPriceInr} per ticket</span>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={decrement}
              disabled={quantity <= 1 || isSubmitting || !isCampaignActive}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#eadbcf] bg-[#fffaf7] text-lg font-bold text-[#7c1619] shadow-2xs hover:bg-[#f8e9df] disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Decrease quantity"
            >
              <Minus size={16} />
            </button>
            <input
              type="number"
              min={1}
              max={maxAllowed}
              value={quantity}
              disabled={isSubmitting || !isCampaignActive}
              onChange={(e) => handleQuantityChange(parseInt(e.target.value, 10))}
              className="h-10 w-16 text-center font-mono text-lg font-bold text-[#35110f] rounded-lg border border-[#eadbcf] bg-white focus:border-[#7c1619] focus:outline-hidden disabled:bg-gray-100"
            />
            <button
              type="button"
              onClick={increment}
              disabled={quantity >= maxAllowed || isSubmitting || !isCampaignActive}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#eadbcf] bg-[#fffaf7] text-lg font-bold text-[#7c1619] shadow-2xs hover:bg-[#f8e9df] disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Increase quantity"
            >
              <Plus size={16} />
            </button>
          </div>

          {/* Quick presets */}
          <div className="flex items-center gap-1.5">
            {[1, 5, 10, 20].map((preset) => (
              <button
                key={preset}
                type="button"
                disabled={isSubmitting || !isCampaignActive || preset > maxAllowed}
                onClick={() => setQuantity(preset)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                  quantity === preset
                    ? "bg-[#7c1619] text-white"
                    : "border border-[#eadbcf] bg-[#fffaf7] text-[#35110f] hover:bg-[#f8e9df]"
                } disabled:opacity-30 disabled:cursor-not-allowed`}
              >
                {preset}
              </button>
            ))}
          </div>

          <div className="text-right ml-auto">
            <p className="text-xs text-[#705a54]">Total Collection Due</p>
            <p className="text-2xl font-bold text-[#7c1619]">₹{totalAmountInr}</p>
          </div>
        </div>
      </div>

      {/* Action Button */}
      <button
        type="submit"
        disabled={isSubmitting || !isCampaignActive}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#7c1619] p-4 font-bold text-white shadow-md transition hover:bg-[#631214] disabled:cursor-not-allowed disabled:bg-gray-400 disabled:opacity-80"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="animate-spin" size={18} />
            <span>Creating order...</span>
          </>
        ) : !isCampaignActive ? (
          <>
            <AlertTriangle size={18} />
            <span>Ticket Sales Inactive (Campaign {campaignStatus})</span>
          </>
        ) : (
          <>
            <span>Create Order & Proceed to Payment (₹{totalAmountInr})</span>
            <ArrowRight size={18} />
          </>
        )}
      </button>

      <div className="flex items-center justify-center gap-2 text-xs text-[#705a54]">
        <ShieldCheck size={16} className="text-[#a41f23]" />
        <span>After creating the order, you will record customer UPI payment / UTR for admin approval</span>
      </div>
    </form>
  );
}

