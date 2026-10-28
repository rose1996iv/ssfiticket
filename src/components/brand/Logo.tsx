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
  md: { width: 56, height: 56, class: "h-14 w-14" },
  lg: { width: 80, height: 80, class: "h-20 w-20" },
  xl: { width: 112, height: 112, class: "h-28 w-28" },
};

/**
 * Official SSFI Brand Logo Component.
 *
 * Renders the circular SSFI emblem as a standalone brand mark with full aspect-ratio
 * preservation, native transparency, and subtle depth elevation.
 */
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
          alt="SSFI Official Emblem"
          width={currentSize.width}
          height={currentSize.height}
          priority={size === "lg" || size === "xl"}
          className="h-full w-full object-contain drop-shadow-[0_2px_8px_rgba(0,0,0,0.22)]"
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
