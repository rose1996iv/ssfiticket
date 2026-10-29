import Image from "next/image";
import Link from "next/link";
import { MapPin, Phone, QrCode, User, ArrowUpRight, ShieldCheck } from "lucide-react";
import type { PublicSellerDto } from "@/server/actions/sellerDirectory";

type Props = {
  sellers: PublicSellerDto[];
};

export function OfficialSellerDirectory({ sellers }: Props) {
  return (
    <section className="border-t border-[#eadbcf] bg-[#fffaf7] px-6 py-16 sm:px-10 sm:py-20">
      <div className="mx-auto max-w-5xl">
        {/* Section Header: Centered Vertical Stack */}
        <div className="flex flex-col items-center text-center">
          <h2 className="glitch-title text-3xl font-bold tracking-tight text-[#35110f] sm:text-4xl">
            Official SSFI Sellers &amp; Regional Directory
          </h2>
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#fceeee] px-3 py-1 text-xs font-bold uppercase tracking-wider text-[#a41f23]">
            <ShieldCheck size={14} />
            <span>Authorized Network</span>
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#705a54]">
            Connect with an authorized regional representative or scan their official referral QR code to
            credit ticket sales directly to their student unit.
          </p>
        </div>

        {/* Sellers Grid or Empty State */}
        {sellers.length === 0 ? (
          <div className="mt-12 rounded-2xl border border-dashed border-[#d8c2b5] bg-white p-12 text-center">
            <QrCode className="mx-auto text-[#a41f23]" size={40} />
            <h3 className="mt-4 text-base font-bold text-[#35110f]">No Public Sellers Listed</h3>
            <p className="mt-2 text-xs text-[#705a54]">
              Regional seller allocations are currently being finalized by the SSFI fundraising committee.
            </p>
          </div>
        ) : (
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {sellers.map((seller) => (
              <div
                key={seller.sellerCode}
                className="flex flex-col justify-between rounded-2xl border border-[#eadbcf] bg-white p-6 shadow-xs transition hover:border-[#d6a23b] hover:shadow-md"
              >
                <div>
                  {/* Region & Code Header */}
                  <div className="flex items-center justify-between border-b border-[#f0e7df] pb-3">
                    <span className="inline-flex items-center gap-1 font-bold text-[#7c1619] text-sm">
                      <MapPin size={15} />
                      <span>{seller.regionName}</span>
                    </span>
                    <span className="rounded-md bg-[#f6eee7] px-2 py-0.5 font-mono text-[11px] font-bold text-[#594541]">
                      {seller.sellerCode}
                    </span>
                  </div>

                  {/* Representative Info */}
                  <div className="mt-4 space-y-2 text-xs text-[#594541]">
                    <div className="flex items-center gap-2">
                      <User size={14} className="text-[#a41f23] shrink-0" />
                      <span className="font-semibold text-[#35110f] text-sm">
                        {seller.representativeName}
                      </span>
                    </div>

                    {seller.contactNumber ? (
                      <div className="flex items-center gap-2">
                        <Phone size={14} className="text-[#a41f23] shrink-0" />
                        <a
                          href={`tel:${seller.contactNumber}`}
                          className="font-mono text-xs hover:text-[#7c1619] hover:underline"
                        >
                          {seller.contactNumber}
                        </a>
                      </div>
                    ) : null}
                  </div>

                  {/* QR Code Presentation */}
                  {seller.qrDataUrl ? (
                    <div className="mt-5 flex flex-col items-center rounded-xl bg-[#fffaf7] border border-[#f0e7df] p-4 text-center">
                      <Image
                        src={seller.qrDataUrl}
                        alt={`Referral QR for ${seller.representativeName} (${seller.sellerCode})`}
                        width={140}
                        height={140}
                        className="rounded-lg shadow-2xs"
                        unoptimized
                      />
                      <span className="mt-2 text-[10px] text-[#80635b]">
                        Scan to open referral booking directly on your phone
                      </span>
                    </div>
                  ) : null}
                </div>

                {/* Direct Action */}
                <div className="mt-6 border-t border-[#f0e7df] pt-4">
                  <Link
                    href={seller.referralPath}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#7c1619] px-4 py-2.5 text-xs font-bold text-white shadow-xs transition hover:bg-[#601114]"
                  >
                    <span>Book via {seller.regionName}</span>
                    <ArrowUpRight size={14} />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

