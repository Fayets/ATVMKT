type BrandLogoProps = {
  /** Altura Tailwind (ej. h-7, h-12); ancho automático según proporción del arte. */
  className?: string
}

export function BrandLogo({ className = 'h-8 w-auto flex-shrink-0 object-contain' }: BrandLogoProps) {
  return (
    <img
      src="/atv-logo.png"
      alt="ATV"
      width={80}
      height={100}
      className={className}
      decoding="async"
    />
  )
}
