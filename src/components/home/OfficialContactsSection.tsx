import { Phone, MessageCircle, UserCheck } from "lucide-react";

const OFFICIAL_CONTACTS = [
  {
    name: "Hlawn Tha Dawt",
    role: "SSFI Leader / Campaign Coordinator",
    phoneDisplay: "+91 69092 51270",
    phoneTel: "+916909251270",
    whatsAppUrl: "https://wa.me/916909251270",
  },
  {
    name: "Joseph",
    role: "SSFI Administrator / Technical Coordinator",
    phoneDisplay: "+91 8810366357",
    phoneTel: "+918810366357",
    whatsAppUrl: "https://wa.me/918810366357",
  },
];

export function OfficialContactsSection() {
  return (
    <section className="border-t border-[#eadbcf] bg-white px-6 py-16 sm:px-10 sm:py-20">
      <div className="mx-auto max-w-5xl">
        {/* Section Header: Centered Vertical Stack */}
        <div className="flex flex-col items-center text-center">
          <h2 className="glitch-title text-3xl font-bold tracking-tight text-[#35110f] sm:text-4xl">
            Contact SSFI Leadership
          </h2>
          <span className="mt-2 text-xs font-bold uppercase tracking-widest text-[#a41f23]">
            Official Support &amp; Enquiries
          </span>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#705a54]">
            For questions about the fundraising campaign, bulk ticket bookings, or manual bank UTR verification,
            please reach out directly to our designated committee leaders.
          </p>
        </div>

        {/* Contacts Grid */}
        <div className="mt-12 grid gap-6 sm:grid-cols-2">
          {OFFICIAL_CONTACTS.map((contact) => (
            <div
              key={contact.phoneTel}
              className="flex flex-col justify-between rounded-2xl border border-[#eadbcf] bg-[#fffaf7] p-6 shadow-xs sm:p-8"
            >
              <div>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#fceeee] text-[#a41f23]">
                    <UserCheck size={20} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-[#35110f]">{contact.name}</h3>
                    <p className="text-xs font-medium text-[#7c1619]">{contact.role}</p>
                  </div>
                </div>

                <div className="mt-6 flex items-center gap-2 text-sm">
                  <Phone size={16} className="text-[#a41f23]" />
                  <a
                    href={`tel:${contact.phoneTel}`}
                    className="font-mono font-semibold text-[#35110f] hover:text-[#7c1619] hover:underline"
                  >
                    {contact.phoneDisplay}
                  </a>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-[#f0e7df]">
                <a
                  href={contact.whatsAppUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] px-5 py-3 text-xs font-bold text-white shadow-xs transition hover:bg-[#20ba59] hover:scale-[1.01]"
                >
                  <MessageCircle size={16} />
                  <span>Chat on WhatsApp</span>
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

