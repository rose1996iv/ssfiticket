"use client";

import { useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  FlaskConical,
  HelpCircle,
  Loader2,
  Mail,
  MessageCircle,
  User,
} from "lucide-react";
import { submitPaymentCompletion } from "@/server/actions/paymentRecovery";
import { validateWhatsAppDigits } from "@/lib/validation/contact";
import { PaymentScreenshotField } from "@/components/payment/PaymentScreenshotField";
import { uploadPaymentScreenshot } from "@/server/actions/paymentScreenshot";

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

type FieldErrors = {
  payerName?: string;
  email?: string;
  whatsapp?: string;
};

type SubmittedSnapshot = {
  payerName?: string;
  email: string;
  whatsapp: string;
};

export function PaymentDetailsForm({
  orderId,
  orderNumber,
  token,
  initialEmail = "",
  suggestedPhone = "",
  initialWhatsapp = "",
  initialPayerName = "",
  isReopening = false,
  isMock = false,
  onSuccess,
}: Props) {
  const [payerName, setPayerName] = useState(initialPayerName);
  const [email, setEmail] = useState(initialEmail);

  // WhatsApp contact logic: prefill from existing phone if available
  const defaultUsesSuggested = Boolean(
    suggestedPhone && (!initialWhatsapp || initialWhatsapp === suggestedPhone)
  );
  const [useSuggestedPhone, setUseSuggestedPhone] = useState(defaultUsesSuggested);
  const [customWhatsapp, setCustomWhatsapp] = useState(
    initialWhatsapp && initialWhatsapp !== suggestedPhone ? initialWhatsapp : ""
  );

  const [loading, setLoading] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submittedSnapshot, setSubmittedSnapshot] = useState<SubmittedSnapshot | null>(null);
  const [screenshot, setScreenshot] = useState<File | null>(null);

  const activeWhatsapp = useSuggestedPhone ? suggestedPhone : customWhatsapp;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError(null);
    setFieldErrors({});

    const trimmedPayerName = payerName.trim();
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedWhatsapp = activeWhatsapp.trim();

    const errors: FieldErrors = {};

    // 1. Payer Name: Optional (max 120 chars)
    if (trimmedPayerName && trimmedPayerName.length > 120) {
      errors.payerName = "Payer name cannot exceed 120 characters.";
    }

    // 2. Customer Email: Valid format, trimmed, lowercase
    if (!trimmedEmail) {
      errors.email = "Email address is required.";
    } else {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmedEmail)) {
        errors.email = "Please enter a valid email address (e.g. name@example.com).";
      }
    }

    // 3. WhatsApp: International E.164, 7-15 digits
    if (!trimmedWhatsapp) {
      errors.whatsapp = "WhatsApp number is required.";
    } else if (!validateWhatsAppDigits(trimmedWhatsapp)) {
      errors.whatsapp =
        "WhatsApp number must contain between 7 and 15 digits (e.g. +91 9876543210).";
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setGeneralError("Please correct the errors in the required fields below.");
      return;
    }

    // Screenshot is mandatory for ALL payment submissions
    if (!screenshot) {
      setGeneralError("A payment screenshot is required. Please upload your payment confirmation screenshot before submitting.");
      return;
    }

    setLoading(true);

    const formData = new FormData();
    formData.set("orderId", orderId);
    if (token) formData.set("token", token);
    formData.set("payerName", trimmedPayerName || "");
    formData.set("email", trimmedEmail);
    formData.set("whatsapp", trimmedWhatsapp);

    try {
      // Step 1: Upload screenshot FIRST so it is stored before details are submitted
      const screenshotData = new FormData();
      screenshotData.set("orderId", orderId);
      if (token) screenshotData.set("token", token);
      screenshotData.set("screenshot", screenshot);
      const upload = await uploadPaymentScreenshot(screenshotData);
      if (!upload.success) {
        setGeneralError(upload.error || "Screenshot upload failed. Please retry.");
        setLoading(false);
        return;
      }

      // Step 2: Submit payment details
      const res = await submitPaymentCompletion(formData);
      if (!res.success) {
        setGeneralError(res.error || "Payment details submission failed. Please try again.");
        setLoading(false);
        return;
      }

      setSubmittedSnapshot({
        payerName: trimmedPayerName || undefined,
        email: trimmedEmail,
        whatsapp: trimmedWhatsapp,
      });
      setLoading(false);
      if (onSuccess) onSuccess();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setGeneralError(err.message);
      } else {
        setGeneralError("An unexpected network error occurred. Please retry.");
      }
      setLoading(false);
    }
  };

  // Read-only confirmation view upon successful submission
  if (submittedSnapshot) {
    return (
      <div
        role="alert"
        aria-live="polite"
        className="rounded-2xl border border-emerald-300 bg-emerald-50/90 p-6 text-[#143e27] shadow-sm animate-in fade-in zoom-in-95 duration-200"
      >
        <div className="flex items-start gap-3.5">
          <div className="rounded-full bg-emerald-100 p-2.5 text-emerald-800 shrink-0">
            <CheckCircle2 size={26} />
          </div>
          <div className="space-y-3 w-full">
            <div>
              <h3 className="font-mono text-lg font-bold text-emerald-950">
                Payment details received. Awaiting Admin Verification.
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-emerald-900">
                Thank you! Your payment confirmation and customer details have been securely recorded for order{" "}
                <b className="font-mono text-emerald-950">{orderNumber}</b>.
              </p>
            </div>

            {/* Read-only snapshot of submitted details */}
            <div className="rounded-xl border border-emerald-200 bg-white/90 p-4 text-xs text-emerald-950 space-y-2.5">
              <span className="text-[10px] uppercase font-bold text-emerald-800 tracking-wider">
                Submitted Payment Record
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-[10px] font-semibold text-emerald-800">Payer Name:</span>
                  <p className="font-bold text-[#35110f]">{submittedSnapshot.payerName || <em className="text-emerald-700 not-italic">Not provided</em>}</p>
                </div>
                <div>
                  <span className="text-[10px] font-semibold text-emerald-800">Payment Screenshot:</span>
                  <p className="font-bold text-emerald-900">Uploaded &amp; Attached</p>
                </div>
                <div>
                  <span className="text-[10px] font-semibold text-emerald-800">Customer Email:</span>
                  <p className="font-medium text-[#35110f]">{submittedSnapshot.email}</p>
                </div>
                <div>
                  <span className="text-[10px] font-semibold text-emerald-800">WhatsApp Contact:</span>
                  <p className="font-mono font-bold text-[#35110f]">{submittedSnapshot.whatsapp}</p>
                </div>
              </div>
            </div>

            {/* Verification next steps callout */}
            <div className="rounded-xl border border-emerald-200 bg-white/70 p-3.5 text-xs text-emerald-950 space-y-1.5">
              <p className="font-bold text-emerald-950 flex items-center gap-1.5">
                <Clock size={14} className="text-emerald-700" />
                What happens next?
              </p>
              <ul className="list-disc pl-4 space-y-1 text-emerald-900 text-[11px] leading-relaxed">
                <li>Our organizers will match your payment against our bank records.</li>
                <li>
                  Your official ticket numbers will be sequentially generated and emailed to{" "}
                  <b>{submittedSnapshot.email}</b> and messaged to{" "}
                  <b>{submittedSnapshot.whatsapp}</b>.
                </li>
                <li>You can return to this page anytime to view the live status of your order.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Informational Guidance Header */}
      <div className="rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4 text-xs leading-relaxed text-[#705a54]">
        <div className="flex items-start gap-2">
          <HelpCircle className="mt-0.5 text-[#7c1619] shrink-0" size={16} />
          <div>
            <p className="font-bold text-[#35110f]">
              {isReopening
                ? "Update your payment confirmation and delivery contact details"
                : "Submit your payment confirmation and delivery contact details"}
            </p>
            <p className="mt-1 text-[11px]">
              After completing your UPI transfer, upload your payment screenshot and provide your contact details below.
              Our team will review your payment and issue your tickets.
            </p>
          </div>
        </div>
      </div>

      {/* Simulated Payment Controls (Dev / Preview) */}
      {isMock && (
        <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50/80 p-3.5 text-xs text-amber-950">
          <p className="flex items-center gap-1.5 font-bold text-amber-900">
            <FlaskConical size={14} />
            <span>Test Payment Simulation (Preview Environment — Test Data Only)</span>
          </p>
          <p className="mt-1 text-[11px] leading-normal text-amber-800">
            Use this quick control to fill test contact details safely:
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setPayerName("Simulated Buyer");
                setEmail(email || "test-customer@example.com");
                setCustomWhatsapp(activeWhatsapp || "+91 98765 43210");
                setGeneralError(null);
                setFieldErrors({});
              }}
              className="rounded-lg bg-amber-200/90 px-2.5 py-1.5 text-[11px] font-semibold text-amber-950 transition hover:bg-amber-300 active:scale-98"
            >
              ✓ Fill Simulated Details
            </button>
          </div>
        </div>
      )}

      {/* General Top Error Banner */}
      {generalError && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-900 shadow-2xs animate-in fade-in duration-200"
        >
          <div className="flex items-start gap-2.5">
            <AlertCircle className="mt-0.5 text-red-600 shrink-0" size={18} />
            <div className="text-xs leading-relaxed">
              <p className="font-bold text-red-950">Submission could not be processed</p>
              <p className="mt-0.5 font-medium">{generalError}</p>
            </div>
          </div>
        </div>
      )}

      {/* 1. Payer Name Field (Optional) */}
      <div>
        <label
          htmlFor="payer-name-input"
          className="block text-xs font-semibold uppercase tracking-wider text-[#705a54]"
        >
          1. Payer Name / Account Holder Name{" "}
          <span className="font-normal text-[#705a54] normal-case tracking-normal">(Optional)</span>
        </label>
        <div className="relative mt-1.5">
          <input
            id="payer-name-input"
            name="payerName"
            type="text"
            maxLength={120}
            value={payerName}
            onChange={(e) => {
              setPayerName(e.target.value);
              if (fieldErrors.payerName) {
                setFieldErrors((prev) => ({ ...prev, payerName: undefined }));
              }
            }}
            placeholder="Name on bank or UPI account (optional)"
            className={`w-full rounded-xl border bg-white p-3 pr-10 text-sm text-[#35110f] transition focus:ring-1 focus:outline-hidden ${
              fieldErrors.payerName
                ? "border-red-500 focus:border-red-600 focus:ring-red-500/20"
                : "border-[#eadbcf] focus:border-[#7c1619] focus:ring-[#7c1619]/20"
            }`}
          />
          <User size={16} className="absolute right-3.5 top-3.5 text-[#705a54]/60 pointer-events-none" />
        </div>
        {fieldErrors.payerName ? (
          <p className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.payerName}</p>
        ) : (
          <p className="mt-1 text-[11px] text-[#705a54]">
            Providing the account holder name helps administrators reconcile your payment faster — but it is not mandatory.
          </p>
        )}
      </div>

      {/* 2. Customer Email Field (Mandatory) */}
      <div>
        <label
          htmlFor="email-input"
          className="block text-xs font-semibold uppercase tracking-wider text-[#705a54]"
        >
          2. Customer Email Address <span className="text-red-500 font-bold">*</span>
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
              if (fieldErrors.email) {
                setFieldErrors((prev) => ({ ...prev, email: undefined }));
              }
            }}
            placeholder="e.g. customer@example.com"
            className={`w-full rounded-xl border bg-white p-3 pr-10 text-sm text-[#35110f] transition focus:ring-1 focus:outline-hidden ${
              fieldErrors.email
                ? "border-red-500 focus:border-red-600 focus:ring-red-500/20"
                : "border-[#eadbcf] focus:border-[#7c1619] focus:ring-[#7c1619]/20"
            }`}
          />
          <Mail size={16} className="absolute right-3.5 top-3.5 text-[#705a54]/60 pointer-events-none" />
        </div>
        {fieldErrors.email ? (
          <p className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.email}</p>
        ) : (
          <p className="mt-1 text-[11px] text-[#705a54]">
            Where your official payment receipt and lucky draw notifications are delivered.
          </p>
        )}
      </div>

      {/* 3. WhatsApp Contact Field (Mandatory) */}
      <div className="rounded-xl border border-[#eadbcf] bg-[#fffaf7] p-4">
        <label className="block text-xs font-semibold uppercase tracking-wider text-[#705a54]">
          3. WhatsApp Contact Number <span className="text-red-500 font-bold">*</span>
        </label>

        {suggestedPhone ? (
          <div className="mt-2 space-y-2.5">
            <label className="flex items-start gap-2.5 cursor-pointer text-xs text-[#35110f]">
              <input
                type="checkbox"
                checked={useSuggestedPhone}
                onChange={(e) => {
                  setUseSuggestedPhone(e.target.checked);
                  if (fieldErrors.whatsapp) {
                    setFieldErrors((prev) => ({ ...prev, whatsapp: undefined }));
                  }
                }}
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
                  Alternate WhatsApp Number <span className="text-red-500">*</span>
                </label>
                <div className="relative mt-1">
                  <input
                    id="custom-whatsapp-input"
                    type="tel"
                    required={!useSuggestedPhone}
                    value={customWhatsapp}
                    onChange={(e) => {
                      setCustomWhatsapp(e.target.value);
                      if (fieldErrors.whatsapp) {
                        setFieldErrors((prev) => ({ ...prev, whatsapp: undefined }));
                      }
                    }}
                    placeholder="+91 98765 43210"
                    className={`w-full rounded-xl border bg-white p-2.5 pr-10 text-sm font-mono text-[#35110f] focus:outline-hidden ${
                      fieldErrors.whatsapp
                        ? "border-red-500 focus:border-red-600"
                        : "border-[#eadbcf] focus:border-[#7c1619]"
                    }`}
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
                if (fieldErrors.whatsapp) {
                  setFieldErrors((prev) => ({ ...prev, whatsapp: undefined }));
                }
              }}
              placeholder="+91 98765 43210"
              className={`w-full rounded-xl border bg-white p-3 pr-10 text-sm font-mono text-[#35110f] focus:outline-hidden ${
                fieldErrors.whatsapp
                  ? "border-red-500 focus:border-red-600"
                  : "border-[#eadbcf] focus:border-[#7c1619]"
              }`}
            />
            <MessageCircle size={16} className="absolute right-3.5 top-3.5 text-[#705a54]/60 pointer-events-none" />
          </div>
        )}

        {fieldErrors.whatsapp ? (
          <p className="mt-1 text-xs font-semibold text-red-600">{fieldErrors.whatsapp}</p>
        ) : (
          <p className="mt-2 text-[11px] text-[#705a54]">
            Your verified tickets and official verification links will be dispatched directly to this WhatsApp number.
          </p>
        )}
      </div>

      {/* Required Fields Notice */}
      <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-[11px] text-amber-950">
        <span className="font-bold text-amber-800">Screenshot Required:</span> A payment screenshot is mandatory for all submissions.
        Your email and WhatsApp are required so we can dispatch your tickets. Payer Name is optional.
      </div>

      {/* Payment Screenshot — MANDATORY for all submissions */}
      <PaymentScreenshotField onChange={setScreenshot} />

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
            <span>{isReopening ? "Update Payment Details & Screenshot" : "Submit Details & Screenshot"}</span>
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
