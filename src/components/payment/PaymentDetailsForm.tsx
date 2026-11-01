"use client";

import { useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  FlaskConical,
  Loader2,
  Mail,
  MessageCircle,
  RefreshCw,
} from "lucide-react";
import { submitPaymentCompletion } from "@/server/actions/paymentRecovery";
import { validateWhatsAppDigits } from "@/lib/validation/contact";

type Props = {
  orderId: string;
  orderNumber: string;
  token?: string;
  initialUtr?: string;
  initialEmail?: string;
  suggestedPhone?: string;
  initialWhatsapp?: string;
  initialPayerName?: string;
  isReopening?: boolean;
  isMock?: boolean;
  onSuccess?: () => void;
};

export function PaymentDetailsForm({
  orderId,
  orderNumber,
  token,
  initialUtr = "",
  initialEmail = "",
  suggestedPhone = "",
  initialWhatsapp = "",
  initialPayerName = "",
  isReopening = false,
  isMock = false,
  onSuccess,
}: Props) {
  const [utr, setUtr] = useState(initialUtr);
  const [email, setEmail] = useState(initialEmail);
  const [payerName, setPayerName] = useState(initialPayerName);

  // WhatsApp contact logic: prefill from existing phone if available
  const defaultUsesSuggested = Boolean(suggestedPhone && (!initialWhatsapp || initialWhatsapp === suggestedPhone));
  const [useSuggestedPhone, setUseSuggestedPhone] = useState(defaultUsesSuggested);
  const [customWhatsapp, setCustomWhatsapp] = useState(
    initialWhatsapp && initialWhatsapp !== suggestedPhone ? initialWhatsapp : ""
  );

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const activeWhatsapp = useSuggestedPhone ? suggestedPhone : customWhatsapp;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const trimmedUtr = utr.trim().toUpperCase();
    const trimmedEmail = email.trim();
    const trimmedWhatsapp = activeWhatsapp.trim();

    // Client-side validations
    if (!trimmedUtr) {
      setErrorMessage("Please enter your UPI reference / UTR number.");
      return;
    }
    if (trimmedUtr.length < 6) {
      setErrorMessage("UTR / Transaction Reference must be at least 6 characters.");
      return;
    }

    if (!trimmedEmail) {
      setErrorMessage("Please enter your email address to receive your order receipt.");
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setErrorMessage("Please enter a valid email address (e.g. name@example.com).");
      return;
    }

    if (!trimmedWhatsapp) {
      setErrorMessage("Please provide an active WhatsApp contact number for ticket delivery.");
      return;
    }
    if (!validateWhatsAppDigits(trimmedWhatsapp)) {
      setErrorMessage(
        "WhatsApp number must be a valid international phone number containing between 7 and 15 digits (e.g. +91 9876543210)."
      );
      return;
    }

    // Mock mode guard on client
    if (isMock) {
      const isTest = /^(TEST|MOCK)[A-Za-z0-9-]*$/i.test(trimmedUtr);
      if (!isTest) {
        setErrorMessage(
          "Preview mock payment mode is active. Please enter a recognized test reference starting with TEST or MOCK (e.g. TEST12345678)."
        );
        return;
      }
    }

    setLoading(true);

    const formData = new FormData();
    formData.set("orderId", orderId);
    if (token) formData.set("token", token);
    formData.set("utr", trimmedUtr);
    formData.set("email", trimmedEmail);
    formData.set("whatsapp", trimmedWhatsapp);
    if (payerName.trim()) {
      formData.set("payerName", payerName.trim());
    }

    try {
      const res = await submitPaymentCompletion(formData);
      if (!res.success) {
        setErrorMessage(res.error || "Payment details submission failed. Please try again.");
        setLoading(false);
        return;
      }

      setSubmitted(true);
      setLoading(false);
      if (onSuccess) onSuccess();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage("An unexpected network error occurred. Please retry.");
      }
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div
        role="alert"
        aria-live="polite"
        className="rounded-2xl border border-emerald-300 bg-emerald-50/80 p-6 text-[#143e27] shadow-sm animate-in fade-in zoom-in-95 duration-200"
      >
        <div className="flex items-start gap-3.5">
          <div className="rounded-full bg-emerald-100 p-2 text-emerald-800 shrink-0">
            <CheckCircle2 size={24} />
          </div>
          <div className="space-y-2">
            <h3 className="font-mono text-lg font-bold text-emerald-950">
              Payment details received. Awaiting Admin Verification.
            </h3>
            <p className="text-xs leading-relaxed text-emerald-900">
              Thank you! Your transaction reference <b className="font-mono text-emerald-950">{utr.trim().toUpperCase()}</b> and
              contact details have been safely registered for order{" "}
              <b className="font-mono text-emerald-950">{orderNumber}</b>.
            </p>
            <div className="rounded-xl border border-emerald-200 bg-white/70 p-3.5 text-xs text-emerald-950 space-y-1">
              <p className="font-semibold flex items-center gap-1.5">
                <Clock size={14} className="text-emerald-700" />
                <span>What happens next?</span>
              </p>
              <p className="text-[11px] text-emerald-800">
                Our organizers will manually inspect bank credit records against your submitted UTR reference. Once confirmed,
                your tickets will be generated and dispatched directly to <b>{activeWhatsapp}</b> and <b>{email}</b>.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSubmitted(false)}
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 underline hover:text-emerald-950"
            >
              <RefreshCw size={12} />
              <span>Need to correct details? Edit submission</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Reopening / Editing Notice */}
      {isReopening && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/80 p-4 text-xs text-blue-950">
          <p className="font-bold flex items-center gap-1.5 text-blue-900">
            <RefreshCw size={14} />
            <span>Updating Existing Submission</span>
          </p>
          <p className="mt-1 text-[11px] text-blue-800">
            Your payment reference is currently under administrator review. You can update your UTR reference, email, or
            WhatsApp contact below if you noticed any typo or error.
          </p>
        </div>
      )}

      {/* Simulated Payment Controls (Dev / Preview) */}
      {isMock && (
        <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50/80 p-3.5 text-xs text-amber-950">
          <p className="flex items-center gap-1.5 font-bold text-amber-900">
            <FlaskConical size={14} />
            <span>Test Payment Simulation (Preview Environment — Test Data Only)</span>
          </p>
          <p className="mt-1 text-[11px] leading-normal text-amber-800">
            Use these quick controls to test form submission safely:
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setUtr(`TEST-MOCK-${Date.now().toString().slice(-6)}`);
                setEmail(email || "test-customer@example.com");
                setPayerName("Simulated Buyer");
                if (errorMessage) setErrorMessage(null);
              }}
              className="rounded-lg bg-amber-200/90 px-2.5 py-1.5 text-[11px] font-semibold text-amber-950 transition hover:bg-amber-300 active:scale-98"
            >
              ✓ Simulate Valid Reference
            </button>
            <button
              type="button"
              onClick={() => {
                setUtr("TEST-DUP-REF");
                if (errorMessage) setErrorMessage(null);
              }}
              className="rounded-lg bg-amber-200/90 px-2.5 py-1.5 text-[11px] font-semibold text-amber-950 transition hover:bg-amber-300 active:scale-98"
            >
              ⚠ Test Duplicate Reference
            </button>
          </div>
        </div>
      )}

      {/* Inline Error Notice */}
      {errorMessage && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-900 shadow-2xs animate-in fade-in duration-200"
        >
          <div className="flex items-start gap-2.5">
            <AlertCircle className="mt-0.5 text-red-600 shrink-0" size={18} />
            <div className="text-xs leading-relaxed">
              <p className="font-bold text-red-950">Please review your submission</p>
              <p className="mt-0.5 font-medium">{errorMessage}</p>
            </div>
          </div>
        </div>
      )}

      {/* 1. UTR Reference Field */}
      <div>
        <label
          htmlFor="utr-input"
          className="block text-xs font-semibold uppercase tracking-wider text-[#705a54]"
        >
          1. UPI Transaction ID / UTR Number <span className="text-red-500">*</span>
        </label>
        <input
          id="utr-input"
          name="utr"
          type="text"
          required
          minLength={6}
          maxLength={64}
          value={utr}
          onChange={(e) => {
            setUtr(e.target.value);
            if (errorMessage) setErrorMessage(null);
          }}
          placeholder={isMock ? "e.g. TEST12345678" : "e.g. 428172918291"}
          className="mt-1.5 w-full rounded-xl border border-[#eadbcf] bg-white p-3 font-mono text-sm text-[#35110f] transition focus:border-[#7c1619] focus:ring-1 focus:ring-[#7c1619]/20 focus:outline-hidden"
        />
        <p className="mt-1 text-[11px] text-[#705a54]">
          {isMock
            ? "Preview Test Mode: Enter any mock reference starting with TEST (e.g. TEST12345678)."
            : 'Found on your UPI receipt under "UTR", "UPI Ref No", or "Google Transaction ID".'}
        </p>
      </div>

      {/* 2. Customer Email Field */}
      <div>
        <label
          htmlFor="email-input"
          className="block text-xs font-semibold uppercase tracking-wider text-[#705a54]"
        >
          2. Customer Email Address <span className="text-red-500">*</span>
        </label>
        <div className="relative mt-1.5">
          <input
            id="email-input"
            name="email"
            type="email"
            required
            maxLength={255}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (errorMessage) setErrorMessage(null);
            }}
            placeholder="e.g. customer@example.com"
            className="w-full rounded-xl border border-[#eadbcf] bg-white p-3 pr-10 text-sm text-[#35110f] transition focus:border-[#7c1619] focus:ring-1 focus:ring-[#7c1619]/20 focus:outline-hidden"
          />
          <Mail size={16} className="absolute right-3.5 top-3.5 text-[#705a54]/60 pointer-events-none" />
        </div>
        <p className="mt-1 text-[11px] text-[#705a54]">
          Used to send your official payment receipt and lucky draw notifications.
        </p>
      </div>

      {/* 3. WhatsApp Contact Field */}
      <div className="rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4">
        <label className="block text-xs font-semibold uppercase tracking-wider text-[#705a54]">
          3. WhatsApp Contact Number <span className="text-red-500">*</span>
        </label>

        {suggestedPhone ? (
          <div className="mt-2 space-y-2.5">
            <label className="flex items-start gap-2.5 cursor-pointer text-xs text-[#35110f]">
              <input
                type="checkbox"
                checked={useSuggestedPhone}
                onChange={(e) => setUseSuggestedPhone(e.target.checked)}
                className="mt-0.5 rounded border-[#eadbcf] text-[#7c1619] focus:ring-[#7c1619]"
              />
              <span className="leading-snug">
                Use order phone number <b className="font-mono text-[#7c1619]">{suggestedPhone}</b> as my active WhatsApp contact.
              </span>
            </label>

            {!useSuggestedPhone && (
              <div className="mt-2 pt-2 border-t border-[#f0e7df]">
                <label
                  htmlFor="custom-whatsapp-input"
                  className="block text-[11px] font-semibold text-[#705a54]"
                >
                  Alternate WhatsApp Number
                </label>
                <div className="relative mt-1">
                  <input
                    id="custom-whatsapp-input"
                    type="tel"
                    required={!useSuggestedPhone}
                    value={customWhatsapp}
                    onChange={(e) => {
                      setCustomWhatsapp(e.target.value);
                      if (errorMessage) setErrorMessage(null);
                    }}
                    placeholder="+91 98765 43210"
                    className="w-full rounded-xl border border-[#eadbcf] bg-white p-2.5 pr-10 text-sm font-mono text-[#35110f] focus:border-[#7c1619] focus:outline-hidden"
                  />
                  <MessageCircle size={16} className="absolute right-3 top-3 text-[#705a54]/60 pointer-events-none" />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="relative mt-1.5">
            <input
              id="whatsapp-input"
              type="tel"
              required
              value={customWhatsapp}
              onChange={(e) => {
                setCustomWhatsapp(e.target.value);
                if (errorMessage) setErrorMessage(null);
              }}
              placeholder="+91 98765 43210"
              className="w-full rounded-xl border border-[#eadbcf] bg-white p-3 pr-10 text-sm font-mono text-[#35110f] focus:border-[#7c1619] focus:outline-hidden"
            />
            <MessageCircle size={16} className="absolute right-3.5 top-3.5 text-[#705a54]/60 pointer-events-none" />
          </div>
        )}

        <p className="mt-2 text-[11px] text-[#705a54]">
          Your verified tickets and official verification links will be dispatched directly to this WhatsApp number.
        </p>
      </div>

      {/* 4. Payer Name (Optional) */}
      <div>
        <label
          htmlFor="payer-name-input"
          className="block text-xs font-semibold uppercase tracking-wider text-[#705a54]"
        >
          Payer Name / Bank Account Name <span className="text-xs font-normal text-[#705a54]">(Optional)</span>
        </label>
        <input
          id="payer-name-input"
          name="payerName"
          type="text"
          maxLength={120}
          value={payerName}
          onChange={(e) => setPayerName(e.target.value)}
          placeholder="Name on your bank account (helps speed up verification)"
          className="mt-1.5 w-full rounded-xl border border-[#eadbcf] bg-white p-3 text-sm text-[#35110f] focus:border-[#7c1619] focus:outline-hidden"
        />
      </div>

      {/* Submission CTA */}
      <button
        type="submit"
        disabled={loading}
        className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#7c1619] p-4 text-sm font-bold text-white shadow-sm transition hover:bg-[#631214] active:scale-99 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {loading ? (
          <>
            <Loader2 className="animate-spin" size={16} />
            <span>Validating &amp; Submitting Details...</span>
          </>
        ) : (
          <>
            <span>{isReopening ? "Update Payment Details" : "Submit Payment Details"}</span>
            <ArrowRight size={16} />
          </>
        )}
      </button>

      <p className="text-center text-[11px] text-[#705a54]">
        Submission registers your details for administrator review. Tickets are issued once bank credit is confirmed.
      </p>
    </form>
  );
}
