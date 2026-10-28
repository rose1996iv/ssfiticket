import Image from "next/image";

type LogoProps = {
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
  showText?: boolean;
  subtitle?: string;
  textColor?: "dark" | "light";
};

const sizeMap = {
  xs: { width: 32, height: 32, class: "h-8 w-8" },
  sm: { width: 44, height: 44, class: "h-11 w-11" },
  md: { width: 64, height: 64, class: "h-16 w-16" },
  lg: { width: 96, height: 96, class: "h-24 w-24" },
  xl: { width: 128, height: 128, class: "h-32 w-32" },
};

export function Logo({
  size = "md",
  className = "",
  showText = false,
  subtitle,
  textColor = "dark",
}: LogoProps) {
  const currentSize = sizeMap[size];

  return (
    <div className={`inline-flex items-center gap-3 ${className}`}>
      <div className={`relative shrink-0 ${currentSize.class}`}>
        <Image
          src="/logo.png"
          alt="SSFI Logo"
          width={currentSize.width}
          height={currentSize.height}
          priority={size === "lg" || size === "xl"}
          className="h-full w-full object-contain"
        />
      </div>

      {showText && (
        <div className="flex flex-col leading-tight">
          <span
            className={`font-bold tracking-tight ${
              size === "xs"
                ? "text-sm"
                : size === "sm"
                ? "text-base"
                : size === "md"
                ? "text-lg"
                : "text-xl"
            } ${textColor === "light" ? "text-white" : "text-[#35110f]"}`}
          >
            SSFI
          </span>
          <span
            className={`text-xs ${
              textColor === "light" ? "text-[#f8e9df]" : "text-[#705a54]"
            }`}
          >
            {subtitle ?? "Fundraising Lucky Draw"}
          </span>
        </div>
      )}
    </div>
  );
}
